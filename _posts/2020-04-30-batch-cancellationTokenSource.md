---
title: Use CancellationTokenSource In Batch Mode
tags: [Lock Contention, CancellationTokenSource, Timer, .NET Framework, Multi-thread, xperf]
excerpt_separator: <!--more-->
---

The .NET platform provides many built-in synchronization primititves. Those primitives cover a broad range of application scenarios. On the down side, they could also lead to perfomrnace problems. The [blog post][gwpost] from Geeks World provides an in depth discussion on the performance issues caused by some commonly used synchronization primitives.

In this post, I'd like to share some experience on the [_CancellationTokenSource_][cts] from the performnace perspective.

<!--more-->

## Long Polling, CancellationTokenSource and Timer

We use long polling to communicate requests between different services and handle timeout. We want the request to return either on timeout or when the request processing was finished.

A typical code pattern:
```
    using (var source = new CancellationTokenSource(Timeout)) {
    	await do_task(source.Token...);
    	source.Token.ThrowIfCancellationRequested();
    	...
    }
```

The Timeout specifies when the CancellationTokenSource will time out. The Token wraps the CancellationTokenSource, and was sent to the down stream tasks. The down stream tasks will return either when Timeout time has elapsed or the task has finished. `ThrowIfCancellationRequested()` throws an exception if the task returns on timeout. The CancellationTokenSource is disposed once the execution is about to leave the `using` body.

That's exactly what we want. Neat!

### The Problem

When we pushed the query per second (QPS) up, we noticed that the CPU usage could easily reach 100%. 

We tested with only upload requests. In this case, the data upload speed became much slower when QPS was up.

After dumping some stack traces using xperf, below two methods stood out in terms of CPU usage:
```
  |-mscorlib.ni.dll!System.Threading.CancellationTokenSource..ctor(System.TimeSpan)
  | mscorlib.ni.dll!System.Threading.CancellationTokenSource.InitializeWithTimer(Int32)
  | |-mscorlib.ni.dll!System.Threading.Timer..ctor(...)
  | | mscorlib.ni.dll!System.Threading.Timer.TimerSetup(...)
  | | |-mscorlib.ni.dll!System.Threading.TimerQueueTimer.Change(...)
  |-mscorlib.ni.dll!System.Threading.CancellationTokenSource.Dispose()
  | mscorlib.ni.dll!System.Threading.CancellationTokenSource.Dispose(Boolean)
  | |-mscorlib.ni.dll!System.Threading.TimerHolder.Close()
  | | mscorlib.ni.dll!System.Threading.TimerQueueTimer.Close()
```

By the way, for those who want to do profiling using xperf, I recommend you instead use [UIforETW][uiforetw], which is a xperf wrapper that has resolved some xperf pain points. Besides, the creator of the tool maintains [a list of blog posts][etwposts] that gives a thorough and in-depth discussion on ETW/xperf profiling.

### Why The Problem

Geeks World's [post][gwpost] had a discussion on the high CPU usage problem introduced by TimerQueue. Apparently, we hit the same.

Here is what happens when a CancellationTokenSource is created in .NET Framework 4.8:
1. A CancellationTokenSource with Timeout is constructed
2. In such a CancellationTokenSource a Timer is constructed
3. The Timer's constructor calls TimerSetup()
4. TimerSetup() constructs a TimerQueueTimer
5. The TimerQueueTimer's constructor calls Change()
6. In Change(), __TimerQueue.Instance__ is locked.
7. In the critical section `TimerQueue.Instance.UpdateTimer()` is called. The newly constructed Timer is inserted to a linked list.
8. The operations in the criticla section are O(1) in terms of timer count. However, I don't know how big or small the constant is.
9. TimerQueue.Instance is a singleton shared across the whole process.

Here is what happens when a CancellationTokenSource is disposed in .NET Framework 4.8:
1. CancellationTokenSource.Dispose(true) is called
2. The timer associated with the CancellationTokenSource is disposed if not disposed before
3. Timer.Dispose() calls Timer.Close()
4. Timer.Close() locks __TimerQueue.Instance__. 
5. In the critical section, `TimerQueue.Instance.DeleteTimer(this)` is called. The timer is removed from the linked list.
6. The operations in the critical section is O(1) in terms of timer count, but you don't know the constant though.

Now, what happens when a CancellationTokenSource/Timer times out?

First of all, Timer class relies on a native timer to synchronize the time in the whole app domain. When we say a Timer "times out", we actually refer that the native timer "times out".

So here is what happens when a native timer times out in .NET Framework 4.8:
1. AppDomainTimerCallback() is called
2. In AppDomainTimerCallBack() `TimerQueue.FireNextTimers()` is called
3. In `TimerQueue.FireNextTimers()`, __TimerQueue.Instance__ is locked
4. In the critical section, the Timer linked list is iterated, and the next fire is updated
5. The operations in the critical section is O(n) in terms of timer count.

We found the bottleneck.

The TimerQueue.Instance is a singleton object in the app domain, and it is used to synchronize the operations on the Timer linked list. Any method that locks the TimerQueue.Instance contends with each other. Unfortunately among these methods, FireNextTimers() will take longer time to finish once the number of active Timers increases.

When our QPS increases, the number of active CancellationTokenSource increases. That means the number of active Timers increases.

The same lock contention applies when you use CancellationTokenSource.CancelAfter() or Task.Delay().

### Mitigation

In .NET Core, the lock contention on TimerQueue is mitigated. It is mitigated by partitioning the Timers in the application domain. Each partition has its own lock to synchronize the Timers in the partition.

The .NET Core fix is also back ported to .NET Framework 4.8. However, the back ported fix is disabled by default. Geeks World's [post][gwpost] has a more detailed discussion on how the fix works and how to enable it in .NET Framework.

Well, what if you are using an older .NET Framework version and don't want to risk the regession to upgrade to .NET Framework 4.8?

Another way to mitigate the issue is trying not to trigger it. That means you limit the QPS on your service process. You can create several processes for the same service and load balance the requests on these processes.

Well, well, what if you don't have time to scale out your service?

## Use CancellationTokenSource in Batch

There is another way to "not trigger the lock contention issue" on TimerQueue.

You cannot control the QPS on the service, but you can control the number of CancellationTokenSource and the underneath Timer.

### The Enlightment

In the old approach, even though two request may time out at the same time, two separate CancellationTokenSources are still created for each request.

Why not __share__ one CancellationTokenSource among the requests?

Let's do it.

### Discretize the Time

We can discretize the absolute time into buckets. Each bucket has a CancellationTokenSource to fire when the real time passed the bucket.
``` 
      ... | bucket 0 | bucket 1 | ... 
  real time -> |
   bucket 0 fires -> |
```

If a request's timeout time falls in bucket 1, it uses bucket 1's CancellationTokenSource.
```
// both request 1 and request 2 use bucket 1's CancellationTokenSource
      ... | bucket 0 | bucket 1 | ... 
  request 1 times out -> |
      request 2 times out -> |
```

The constructed CancellationTokenSources are stored in a dictionary. The key is the finish time of a bucket.

By controlling the bucket size, the nubmer of active CancellationTokenSource/Timers can be controlled accordingly.

To share CancellationTokenSource between requests, a CancellationTokenSource is not disposed when a request finishes.

Before a CancellationTokenSource times out, it could be reused again and again.

A background thread is in charge of disposing all timed out CancellationTokenSources.

### The Side Effect

Apparently, the granularity of the Timeout is increased to the bucket size. That means, a request may delay the bucket size time before it times out.

## Refinement

In the batched CancellationTokenSource, all CancellationTokenSources are retrieved from the CancellationTokenSource dictionary. The dictionary is accessed by all requests, and may become the new bottleneck.

In a naive implementation, a CancellationTokenSource is created by the first request that needs it, and put into the dictionary. `new CancellationTokenSource(..)` is a relatively long operation. The more requests there are, the longer the operation may be.

Apparently all the read and write to the dictionary should be protected by a lock. The same applies to the `new` and the `put into the dictionary`. The long `new` will block all other requests waiting to get a CancellationTokenSource, and worsen the lock contention on the dictionary.

You may argue that the CancellationTokenSource can be constructed before entering the lock. The problem is multiple threads may construct its own CancellationTokenSource and only one of them is put into the dictionary. The extra construction will exacerbate the lock contention issue on TimerQueue, which is what we tried to avoid in the first place.

### Fine Grained Lock

A CancellationTokenSource is shared by requests falling into the same bucket. Ideally only these requests need to be synchronized.

Similar to the fix in .NET Core, we can partition the buckets. For example, separate the dictionary into 16 partitions by the low four bits of the key.

We can pre-allocate the 16 locks. Each partition is synchronized by one of the 16 locks.

### Pre-Allocate CancellationTokenSource

If we have a priori knowledge of the traffic's Timeout, we could pre-allocate the CancellationTokenSources. Thus, the `new CancellationTokenSource` is never hit on the critical path.

A simple yet reasonable policy is that we could assume that recently used Timeout will be used again in the near future.

To implement this policy, record the Timeout and the request arriving time of every request in a dictionary. The key is the Timeout and the value is the request arriving time.

A separate thread could be created to pre-allocate the CancellationTokenSource for the Timeouts in the dictionary. Only the Timeouts that are added after `current_time - T` are used. Those older Timeouts are discarded during the iteration.

The pre-allocate thread runs periodically. The rule of thumb is that the pre-allocated CancellationTokenSource in this pre-allocation should cover all the requests coming before the next pre-allocation, provided the Timeouts of the requests are in the Timeout dictionary.
```
// ---- represents the time range that should be covered by the first pre-allocation. The time range has the same length as the pre-allocate period.
bucket:          |    |    |    |    |    |    |
pre-allocate:      |        |        |
                   | Timeout       |--------|
```
Therefore, the number of pre-allocated CancellationTokenSource per Timeout is 
```
ceil(pre-allocate_period / bucket_size) + 1
```

A subtle thing is, two requests having the same Timeout is a too stringent requirement in reality. Oftenly, two requests's Timeouts differ in the last several least significant digits. Directly adding a Timeout to the dictionary will quickly oversize the dictionary. Actually, since the CancellationTokenSource's granularity is the bucket size, a finer granularity for the Timeout is not necessary. The Timeout could and should be discretized to the bucket size before adding to the dictionary. The discretization prevents the Timeout dictionary from being oversized.

With discretized Timeout, the range that a pre-allocation should cover increases.
```
// ---- represents the time range that should be covered by the first pre-allocation. The time range has the same length as the pre-allocate period.
// **** represents the extra time range that should be covered by the first pre-allocation. The extra range has the same length as the bucket size.
bucket:          |    |    |    |    |    |    |
pre-allocate:      |        |        |
                   | Timeout       |--------|
                              |****|
```
The number of pre-allocated CancellationTokenSource per Timeout becomes
```
ceil(pre-allocate_period / bucket_size) + 2
```

Oversized Timeout dictionary could still be a problem. To mitigate it, the `T` could be decreased when the dictionary is oversied and reverted back when the dictionary size becomes normal.

## The Result

With the refined version of the batch CancellationTokenSource, we mitigated the lock contention issue on TimerQueue. Other bottlenecks in the code path had the chance to be exposed.

Eventually, we reduced the CPU usage from 100% to \~90% on average, and increased the upload speed to the original's \~4x.


[gwpost]: https://geeks-world.github.io/articles/468611/index.html#h3
[cts]: https://docs.microsoft.com/en-us/dotnet/api/system.threading.cancellationtokensource?view=netframework-4.8
[uiforetw]: https://github.com/google/UIforETW
[etwposts]: https://randomascii.wordpress.com/2015/09/24/etw-central/