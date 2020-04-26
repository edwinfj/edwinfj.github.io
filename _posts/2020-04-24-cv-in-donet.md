---
title: Condition Variable in .NET Framework
tags: [condition variable, .NET Framework, multi-thread, lock]
excerpt_separator: <!--more-->
---

## Motivation

As a C++ programmer coming to the C# world, while writing multi-thread programs, the thing I miss the most is [condition variable][cv-link].

I googled for a while trying to find a built-in counterpart or a crafted solution in .NET Framework. I failed. The top results returned were either wrong statements, or a design that lacked generalization.
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

To apply above code pattern, the requirements listed below need to be fulfilled:

1. Each condition variable instance has its own waiting queue.
2. The condition variable should at least support below three interfaces:
  - `void wait(lock)`: the caller thread releases the lock and waits in the condition variable's waiting queue.
  - `void signal()`: one of the waiting thread in the condition variable's waiting queue will be waken up and ready to run.
  - `void broadcast()`: all the waiting threads in the condition variable's waiting queue will be waken up and ready to run.
3. A waiting thread on the condition variable's waiting queue is bound to wake up after some signal() calls.
4. The condition variable is stateless. I.e., if no wait() has been called, the signal() called currently will not change any thread's ready status.

## Synchronization Primitives in .NET Framework
.NET Framework 4.8 provides many synchronization primitives in [_System.Threading_][threading-link] namespace, such as WaitHandle class and its derivations (Mutex, Semaphore, AutoResetEvent, etc.), Monitor, SpinLock, ReaderWriterLock.

WaitHandle and its derivations are all stateful. That means a signal() equivalent API call will affect the next wait() call. This breaks requirement 4. Besides, since the state is managed by WaitHandle class, there is no `void wait(lock)` equivalent API.

### The Common Pitfall: Monitor as Condition Variable

Some people stated that [_System.Threading.Monitor_][monitor-link] is a counterpart to the condition variable.

I don't think so. 

Indeed, Monitor is stateless. However, it is a static class and it does not have its own waiting queue. Applying Monitor to the code pattern above, it would be like:
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
The problem is, the states maintained in updateStatesX() need to be synchronized. Therefore I have to use one lock in thread 1 and thread 2. Monitor.Wait(obj) calls on the object it acquired before, and waits on that object, therefore both thread 1 and thread 2 are waiting on obj. When another thread calls Monitor.Pulse(obj), either thread 1 and thread 2 could be woken up.

It failed to implement the code pattern above.

## Implement Condition Variables with Semaphores
Luckily, [Andrew Birrell has studied this topic back in 2003][ab-paper]. It's feasible to implement condition variables with semaphores. Apply his solution to .NET Framework, it would be like:
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

Each wait() makes the calling thread to wait in a semaphore's waiting queue. All the semaphores of a condition variable are stored in a queue, which becomes the condition variable's very own waiting queue. The maximum size of the queue is the maximum possible number of threads in the process.

The queue becomes a global state. However, since when wait(), signal() or broadcast() is called a lock has been acquired, no more lock is required to synchronize the state of the queue.

I chose to use SemaphoreSlim because I don't need synchronization cross process boundaries. You can adapt the code to your own needs.

Make sure wrap the code in a try block, and release the lock in the finally block.

### Performance Improvement
Since wait(), signal() and broadcast() are in the sync body, each of them could become the performance bottleneck. Based on my experience, object generation and garbage collection is time consuming in .NET Framework. It's better to avoid frequent `new` in the sync body, as in wait().

Instead of creating a new semaphore and discard it in each wait, we could allocate semaphores beforehand and store them in a bounded queue. In each wait(), the semaphore on the front of the queue is used. Make sure the bounded queue size is large enough to feed all the threads.

## A Second Thought on .NET Synchronization Primitives

The most commonly used synchronization models are producer/consumer, reader/writer and barrier.

As C++ programmer, I would choose to implement them using condition variables and mutexes. In .NET, there are _Barrier_ and _ReaderWriterLock_ classes. The producer/consumer could be implemented using other primitives with care.

I guess the reason that .NET does not have condition variable is that the it tries to discourage users from implementing synchronization models from scratch. Multi-threaded code is notorious to be bug prone and difficult to debug. Users better leave them to more experienced teams.

Well, however, it's never guaranteed that all use cases can be covered by a constant number of synchronization models. Given the benefits of condition variables, giving it up would result in a much more difficult situation when the synchronization models provided by the library does not cover the use case.

[cv-link]: https://en.cppreference.com/w/cpp/thread/condition_variable
[threading-link]: https://docs.microsoft.com/en-us/dotnet/api/system.threading?view=netframework-4.8
[monitor-link]: https://docs.microsoft.com/en-us/dotnet/api/system.threading.monitor?view=netframework-4.8
[ab-paper]: http://birrell.org/andrew/papers/ImplementingCVs.pdf