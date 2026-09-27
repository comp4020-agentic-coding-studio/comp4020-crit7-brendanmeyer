# Crit 7 reflection

**What was the breakthrough that moved the work forward?**

The overlap-detection feature kept coming back with the same shape of feedback: "work out the difference, not just accept or reject," then "split it into two leave requests." Each time I asked Claude for a specific fix, it did exactly what it thought that I wanted. It never worked out these were the same problem showing up across fix attempts. I had to notice that myself: stop treating a day as either fully blocked or fully free, and stop assuming "the remainder" is always one chunk. Once I pushed Claude to track hours used per day instead of a yes/no flag, every earlier special case turned out to be that same logic with the numbers pinned at 0 or a full day. Claude tried to write off the trickiest case as a scope cut when the real fix was smaller than a workaround it wanted to implement.

**What did this work change about who I want to be as a software developer?**

It changed how much I trust Claude's answer. If it is left to itself it will implement whatever specific fix it thinks I ask for and move on, it does not notice that repeated bits of feedback as the same problem. That is something that I have to catch. So now when I review what it has build, I have to check not only if what it has done is working, but that is actually follows the design goals. It is the same habit from crit 5: write more up front, then check the work rather than trusting green checkmarks. This crit just gave me a concrete example of what that checking looks like when the code runs fine but the design underneath it is wrong.
