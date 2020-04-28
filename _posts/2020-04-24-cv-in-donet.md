---
title: Condition Variable in .NET Framework
tags: [condition variable, .NET Framework, multi-thread, lock]
excerpt_separator: <!--more-->
---

## Motivation

As a C++ programmer coming to the C# world, the thing I miss the most when writing multi-threaded programs is [condition variable][cv-link].

I googled for a while trying to find a built-in counterpart or a crafted solution in .NET Framework. I failed. The top results returned were either wrong, or a design that lacked generalization.
<!--more-->

## Minimal Requirements For The Condition Variable

A common use case for the condition variable is:
```	
    CV queueOne, queueTwo;
    ...
    // thread 1
    lock.acquire();
    updateStates1();
    while (!predicate1()) {
        queueOne.wait(lock);
    }
    updateStates2();
    lock.release();
    ...
    lock.acquire();
    updateStates3();
    queueTwo.signal();
    lock.release();

    // thread 2
    lock.acquire();
    updateStates4();
    while(!predicate2()) {
        queueTwo.wait(lock);
    }
    updateStates5();
    lock.release();
    ...
    lock.acquire();
    updateStates6();
    queueOne.signal();
    lock.release();
```

To apply above code pattern, a condition variable should at least fulfill the requirements listed below:

1. Each condition variable object has its own waiting queue.
2. The condition variable should at least support below three interfaces:
  - `void wait(lock)`: the calling thread releases the lock and waits in the condition variable's waiting queue.
  - `void signal()`: one of the waiting thread in the condition variable's waiting queue will be waken up and ready to run.
  - `void broadcast()`: all the waiting threads in the condition variable's waiting queue will be waken up and ready to run.
3. A waiting thread on the condition variable's waiting queue is bound to wake up after some signal() calls.
4. The condition variable is stateless. I.e., if no wait() has been called, the signal() called currently will not change any thread's ready status.

## Synchronization Primitives in .NET Framework
.NET Framework 4.8 provides many synchronization primitives in [_System.Threading_][threading-link] namespace, such as WaitHandle class and its derivations (Mutex, Semaphore, AutoResetEvent, etc.), Monitor, SpinLock, and ReaderWriterLock.

[_WaitHandle_][waithandle] and its derivations are all stateful. That means a signal() equivalent API call will affect the next wait() call. This breaks requirement 4. Besides, since the lock state is managed by WaitHandle objects, there is no `void wait(lock)` equivalent API.

### The Common Pitfall: Monitor as Condition Variables

Some people stated that [_System.Threading.Monitor_][monitor-link] is a counterpart to the condition variable.

I don't think so. 

Indeed, Monitor is stateless. However Monitor is a static class and it does not have its own waiting queue. Applying Monitor to the code pattern above, it would be like:
```
    // thread 1
    Monitor.Enter(obj)
    updateStates1();
    while (!predicate1()) {
    	Monitor.Wait(obj);
    }
    updateState2();
    Monitor.Exit(obj);
    ...
    Monitor.Enter(obj);
    updateState3();
    Monitor.Pulse(obj);
    Monitor.Exit(obj);

    // thread 2
    Monitor.Enter(obj);
    updateStates4();
    while (!predicate2()) {
    	Monitor.Wait(obj);
    }
    updateState5();
    Monitor.Exit(obj);
    ...
    Monitor.Enter(obj);
    updateState6();
    Monitor.Pulse(obj);
    Monitor.Exit(obj);
```
The problem is, the states maintained in updateStatesX() need to be synchronized. Therefore a single lock is required to synchronize all the updateStatesX() in thread 1 and thread 2. Monitor.Wait(obj) calls on the object it has acquired, and waits on that object. As a result both thread 1 and thread 2 are waiting on obj. When another thread calls Monitor.Pulse(obj), it does not control which thread to wake up. Both thread 1 and thread 2 could be waken up.

As a result, using Monitor alone failed to implement the code pattern above.

## Implement Condition Variables with Semaphores
Luckily, [Andrew Birrell has studied this topic back in 2003][ab-paper]. It's feasible to implement condition variables with semaphores. Adapting his solution to .NET Framework, it would be like:
```
    class CV {
        Queue<SemaphoreSlim> waitQueue = new Queue<SemaphoreSlim>();

        // make sure the calling thread has acquired lockObj
        void wait(ref object lockObj) {
            SemaphoreSlim s = new SemaphoreSlim(0);
            waitQueue.Enqueue(s);
            Monitor.Exit(lockObj);
            s.Wait();
            Monitor.Enter(lockObj);
        }

        // make sure the calling thread has acquired lockObj
        void signal() {
            if (waitQueue.Count != 0) {
                s = waitQueue.Dequeue();
                s.Release();
            }
        }

        // make sure the calling thread has acquired lockObj
        void broadcast() {
            while (waitQueue.Count != 0) {
                s = waitQueue.Dequeue();
                s.Release();
            }
        }
    }
```

Each wait() makes the calling thread to wait in a semaphore's waiting queue. All the semaphores of a condition variable are stored in a queue, which becomes the condition variable's very own waiting queue. The size of the queue could grow but is topped by the maximum number of threads in the process.

The queue becomes a global state, and needs to synchronize across multiple threads. However, each wait(), signal() or broadcast() call assumes that a lock has been acquired, therefore no more lock is needed to synchronize the state of the queue.

I chose to use [_SemaphoreSlim_][semaphoreslim] because I don't need synchronization to cross process boundaries. If you need inter-process synchronization, you can replace SemaphoreSlim with [_Semaphore_][semaphore] and replace Monitor with [_Mutex_][mutex].

### Performance Improvement
Since wait(), signal() and broadcast() are in the sync body, each of them could become the performance bottleneck. Based on my experience, object generation and garbage collection are time consuming in .NET Framework. It's better to avoid frequent `new` in the sync body.

Instead of creating a new semaphore and discard it in each wait(), semaphores could be allocated and stored in a bounded queue beforehand. In each wait(), the semaphore on the front of the queue is retrieved and used.

Pay attention that the size of the queue should be large enough to feed all the threads. This is very important.

A subtle thing in the bounded queue approach is, if you cannot guarantee that the queue size is big enough to feed all the threads, you will need three pointers rather than two to maintain the queue states.
- The first pointer points to the first semaphore with count 0 and has no waiting thread. It's updated in wait().
- The second pointer points to the first semaphore with count 0 and has 1 waiting thread. It's updated in signal() or broadcast().
- The third pointer points to the first semaphore with count 1 and has 1 waiting thread. This would be the tail of the queue. It's updated in wait(). Besides, it's updated after releasing the lockObj. Therefore an extra lock is needed to synchronize its change.

An alternative to bounded queue is linked list. Just swap the free semaphore to the tail of the linked list. Similar to the bounded queue, three pointers are required to maintain the linked list.

## A Second Thought on .NET Synchronization Primitives

The most commonly used synchronization models are producer/consumer, reader/writer and barrier. As a C++ programmer, I would choose to implement them using condition variables and mutexes.

As in .NET, there exists the [_Barrier_][barrier] and [_ReaderWriterLock_][rwlock] classes. The producer/consumer model could be implemented using other primitives with care.

I guess the reason that .NET does not provide condition variable is that it tries to discourage users from implementing synchronization models from scratch. Multi-threaded code is notorious to be bug prone and difficult to debug. It better be left to the more experienced programmers.

Well, however, no one can guarante that all the user use cases can be covered by a constant number of synchronization models. Given the benefits of condition variables, discarding it would result in a much more difficult situation when the synchronization models provided by the library does not cover the use cases.

[cv-link]: https://en.cppreference.com/w/cpp/thread/condition_variable
[threading-link]: https://docs.microsoft.com/en-us/dotnet/api/system.threading?view=netframework-4.8
[monitor-link]: https://docs.microsoft.com/en-us/dotnet/api/system.threading.monitor?view=netframework-4.8
[ab-paper]: http://birrell.org/andrew/papers/ImplementingCVs.pdf
[waithandle]: https://docs.microsoft.com/en-us/dotnet/api/system.threading.waithandle?view=netframework-4.8
[semaphoreslim]: https://docs.microsoft.com/en-us/dotnet/api/system.threading.semaphoreslim?view=netframework-4.8
[semaphore]: https://docs.microsoft.com/en-us/dotnet/api/system.threading.semaphore?view=netframework-4.8
[mutex]: https://docs.microsoft.com/en-us/dotnet/api/system.threading.mutex?view=netframework-4.8
[barrier]: https://docs.microsoft.com/en-us/dotnet/api/system.threading.barrier?view=netframework-4.8
[rwlock]: https://docs.microsoft.com/en-us/dotnet/api/system.threading.readerwriterlock?view=netframework-4.8