# Process overview

## What I built

HORUS-lite: a PeopleSoft-style leave-management prototype covering the full loop a real ANU absence system needs — employee applies for leave, manager approves or denies, employee can cancel before or after approval, manager actions the cancellation, and a manager can see an employee's full history — with real leave balances that decrement on approval and restore on an approved cancellation, plus overlap detection against an employee's own existing bookings. `README.md` covers what the app is and what good means here; this is the account of how the build actually went.

## How I got here

**Planning before code.** This time I got claude to build the `CLAUDE.md` with a smaller version of the plan, and then a separate `docs/plan-leave-management.md` which houses the real workflow, data model, business rules, route table, and testing strategy in 
before writing any app code [`a1e3949`](https://github.com/comp4020-agentic-coding-studio/comp4020-crit7-brendanmeyer/commit/a1e3949). A state machines was also modeled so that Claude would be able to develop the app with a strict set of process rules.

**Core build, one layer at a time to replicate the orginal system** Claude was instructed to develop each stage to build a replicate state of the original system, it was provided details about the underlying system as well as available documentation for staff to use the system it was replicating. It didn't replicated the looks, but it replicated the functionality which is what this crit is about. The schema, then helpers, the employee pages, the manager pages, then the first test coverage [`848f235...3e7eb45`](https://github.com/comp4020-agentic-coding-studio/comp4020-crit7-brendanmeyer/compare/848f235...3e7eb45).
Using the running app showed needed fixes: durations shown in days instead of the hours the balance is actually tracked in, and forms that reset on a failed submit instead of keeping what was typed [`53ce7c4...32f7434`](https://github.com/comp4020-agentic-coding-studio/comp4020-crit7-brendanmeyer/compare/53ce7c4...32f7434).

**The changes:**
- **Overlap detection, and then generalizing it three times over**
One of the biggest features missing, was the sytem being able to handle overlapping/same day leave requests. Now the sytem can allow someone to put in further requests without the need to forced cancelations and newly made requets [`e810c18...1e13149`](https://github.com/comp4020-agentic-coding-studio/comp4020-crit7-brendanmeyer/compare/e810c18...1e13149).
A live preview endpoint made the check proactive instead of reactive [`389a473`](https://github.com/comp4020-agentic-coding-studio/comp4020-crit7-brendanmeyer/commit/389a473), [`d08bbfa`](https://github.com/comp4020-agentic-coding-studio/comp4020-crit7-brendanmeyer/commit/d08bbfa).
To handle overlapping requests, the system can split it into two separete leave requests (more user friendly and efficient) [`2a653c2...cab6992`](https://github.com/comp4020-agentic-coding-studio/comp4020-crit7-brendanmeyer/compare/2a653c2...cab6992).

- **Small UI fixes from actually using the form.**
A single-day hour selector, a sticky navbar, and hiding the second date if it isn't needed [`261abeb`](https://github.com/comp4020-agentic-coding-studio/comp4020-crit7-brendanmeyer/commit/261abeb), [`a3f484a`](https://github.com/comp4020-agentic-coding-studio/comp4020-crit7-brendanmeyer/commit/a3f484a), [`7a664a7`](https://github.com/comp4020-agentic-coding-studio/comp4020-crit7-brendanmeyer/commit/7a664a7).
