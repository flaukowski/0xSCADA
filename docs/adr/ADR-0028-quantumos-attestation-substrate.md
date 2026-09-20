# ADR-0028: QuantumOS as an Attestation Substrate for the Control Path

## Status
Proposed — **blocked on empirical validation** (see Open Questions)

## Date
2026-09-20

## Context

QuantumOS is a capability-secure operating system operated from a `qsh` prompt, currently exposed through OpenBotCity's Kernel Gauntlet. Its stated design property is the one worth our attention, quoted from its own rules:

> the KERNEL ITSELF is the referee: success is read from QuantumOS's unforgeable audit ledger and boot attestation, never from what you print.

and

> every attempt to exceed your capabilities is denied and recorded.

0xSCADA's hardest unsolved problem is the same sentence in industrial clothing: **who was permitted to issue a control command, and can you prove afterwards what actually happened.**

Today we answer both in application code. The TypeScript gateway authenticates the caller, authorises the operation, executes it, and then writes a record of what it did. Every one of those steps happens inside the process being audited. **A log an application writes about itself is the same class of evidence as a status field an application sets about itself** — and this project already carries 31 open issues, several of which are about state that reports something other than what is true.

A capability-secure kernel separates those concerns structurally. Authority is not a claim the process makes; it is a capability the process either holds or does not, and the kernel denies and records every attempt to exceed it. For a DNP3 or IEC-61850 control operation, that is the correct shape: an operator who must not be able to trip a breaker should not be in a position to *ask nicely*.

## Decision

**Evaluate QuantumOS as an attestation and audit substrate for the control path only. Do not port the stack.**

This ADR deliberately proposes the narrow thing. The broad thing — "run 0xSCADA on QuantumOS" — is not currently a coherent engineering goal, and saying so is part of the decision:

- 0xSCADA is TypeScript on Node, shipped with Docker, Helm and k8s manifests. QuantumOS's exposed surface is `qsh` and a small command set (`ps`, `ls`, `cat`, `ghost`, `imprint`, `recall`, `qseed`).
- The Gauntlet VM has **no network** and is **destroyed when the attempt ends**. That is an evaluation surface, not a deployment target.
- There is no evidence QuantumOS hosts a Node runtime or a TCP stack. Every protocol adapter we have — DNP3, IEC-61850, Modbus, OPC-UA — is a wire protocol and requires both.

Proposing a port on this evidence would be a wish with better formatting. The narrow proposal is testable; the broad one is not yet a question.

## Open questions — none of these are answerable from documentation

These must be answered **from the machine**, and the ADR should not advance until they are:

1. **Does QuantumOS exist outside the Gauntlet VM?** Is there an image, a host story, a hardware target — or is it only ever a scored sandbox?
2. **Is there a network stack?** Without one, no protocol adapter runs, and the integration can only ever be offline attestation of records produced elsewhere.
3. **What is the capability model's granularity?** Per-process, per-object, or per-operation? Control-path value depends entirely on whether "may write a setpoint on asset X" is expressible as a capability.
4. **Is the audit ledger externally readable, and by whom?** An unforgeable ledger that nothing outside the kernel can read is a diary. Regulatory audit requires export.
5. **What does `the-attestation` scenario actually bind?** Its blurb is "emit a Lamport attestation binding the boot qseed to a target payload." If boot state can be bound to a payload, that is precisely a signed provenance record for a control action — but "precisely" needs to be demonstrated, not inferred from a blurb.
6. **Does the ledger survive reboot, and can it be exported?** SCADA audit that does not outlive the process is not audit.

## Blocked on

`POST /ctf/attempts {"scenario_slug":"first-boot"}` returns **"The Kernel Gauntlet is offline right now"** — observed twice, 2026-09-20 ~21:20Z. Until a VM boots, every answer above is speculation.

Worth recording as its own small defect: `GET /ctf/scenarios` returns `first-boot` with no status field, and `GET /challenges/ctf.md` describes it as "(intro, LIVE)". Neither surface says offline. **The only way to discover the Gauntlet is down is to attempt a run and be refused** — a listing that advertises availability the attempt endpoint denies.

## Consequences

- **Next step is operational, not architectural.** Run `first-boot` when the Gauntlet returns, then answer Q1–Q6 from the machine.
- If the answers support it, ADR-0029 specifies a concrete integration for the control path.
- If they do not, **this ADR is closed as Rejected with the reasons recorded** — which is a result, not a failure, and cheaper than the port it prevents.
- No code changes, no dependencies, and no roadmap commitments follow from accepting this ADR. It authorises an evaluation and nothing else.

## Notes

Filed by 0xSCADA-QE. The attraction here is not novelty — it is that QuantumOS's central claim and this project's central weakness are the same proposition viewed from two sides. A kernel that refuses to take a process's word for what it did is the thing a SCADA audit trail has always wanted to be. That is a reason to go and measure it, and not yet a reason to build on it.
