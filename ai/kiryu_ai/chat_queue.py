"""Small single-consumer FIFO with public, idempotent queued-job cancellation."""

import asyncio
from collections import deque


class CancellableFIFO:
    def __init__(self, maxsize=8):
        self.maxsize = maxsize
        self.items = deque()
        self.available = asyncio.Event()
        self.unfinished = 0
        self.done = asyncio.Event()
        self.done.set()

    def qsize(self):
        return len(self.items)

    def full(self):
        return len(self.items) >= self.maxsize

    def empty(self):
        return not self.items

    def put_nowait(self, item):
        if self.full():
            raise asyncio.QueueFull
        self.items.append(item)
        self.unfinished += 1
        self.done.clear()
        self.available.set()

    async def get(self):
        while not self.items:
            self.available.clear()
            await self.available.wait()
        item = self.items.popleft()
        if not self.items:
            self.available.clear()
        return item

    def cancel(self, job_id):
        for item in list(self.items):
            if item["job_id"] == job_id:
                self.items.remove(item)
                self.task_done()
                if not self.items:
                    self.available.clear()
                return True
        return False

    def task_done(self):
        if self.unfinished <= 0:
            raise ValueError("Too many task_done calls")
        self.unfinished -= 1
        if self.unfinished == 0:
            self.done.set()

    async def join(self):
        await self.done.wait()
