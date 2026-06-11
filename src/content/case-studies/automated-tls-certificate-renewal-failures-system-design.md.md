---
layout: ../../layouts/CaseStudy.astro
title: Certificate Lifecycle Management as a Reliability Problem — Automated TLS Renewal, Silent Failure Modes, and the Case for Redundancy
client: Large Enterprise
date: 2026
tags: [TLS, Certificate Management, ACME, Let's Encrypt, DNS-01, CAA, DNSSEC, mTLS, Reliability Engineering, Production Outage]
summary: A system design discussion examining how automated TLS certificate renewal pipelines fail silently, the DNS and CA configuration conditions that block renewal without observable signals, and why treating certificate lifecycle as a reliability concern rather than a configuration task is the only durable protection against expiry-driven production outages.
---

## Overview

Automated TLS certificate management is one of those infrastructure concerns that gets treated as solved the moment it is set up. A certificate authority is configured, an ACME client is running, DNS records are in place, and renewals happen on a schedule without operator involvement. The system works quietly in the background, and because it works quietly, it is easy to forget it exists — until it stops working.

Certificate expiry is a known, scheduled, predictable failure mode. Unlike most production incidents it does not arrive without warning. The expiry date is embedded in the certificate itself, visible to anyone who looks. And yet certificate-related outages continue to occur regularly across organisations of every size and maturity level. The reason is almost never the certificate authority or the ACME protocol. It is the design of the system responsible for renewal — specifically the assumptions baked into it about what happens when automation fails.

This document examines certificate lifecycle management as a system design problem, identifies where common automation architectures are fragile, and makes the case for treating renewal as a reliability concern that deserves the same redundancy and observability investment as any other critical infrastructure dependency.

---

## How Automated Certificate Renewal Works

The dominant model for automated certificate issuance today is the ACME protocol, used by Let's Encrypt and a growing number of other certificate authorities. The protocol allows a client to prove domain ownership and obtain a certificate programmatically, with no human in the loop.

Domain ownership is proved via a challenge. The two most common challenge types are:

**HTTP-01** — the client places a token at a well-known path on the domain's web server, and the CA retrieves it over HTTP to confirm control.

**DNS-01** — the client creates a TXT record at a specific subdomain (`_acme-challenge.<domain>`), and the CA queries DNS to confirm control. This method supports wildcard certificates and works for domains that do not serve HTTP traffic.

Once the challenge is satisfied, the CA issues a certificate valid for 90 days. The ACME client is responsible for initiating renewal before expiry — typically starting 30 days out — and repeating the process automatically.

The 90-day validity window is a deliberate design choice. Short-lived certificates limit the exposure window if a certificate is compromised and push the ecosystem toward automation by making manual renewal impractical at scale. The expectation is that renewal is never a human task.

---

## Where the Architecture Is Fragile

The ACME protocol itself is robust. The fragility is in the systems built around it — specifically in three areas: the renewal trigger, the challenge pipeline, and observability.

### The Renewal Trigger

Automated renewal requires something to initiate it. In simple deployments this is a cron job or a daemon running on the same machine as the web server. In more complex environments it may be a managed service, a platform component, or an orchestration layer.

The renewal trigger is almost always tied to the operational state of the surrounding infrastructure. A managed platform may gate renewal attempts on whether the service is considered fully provisioned and healthy. An orchestration system may skip renewal for services it considers degraded. A cron job on a host that has been replaced or rescheduled may simply not run.

This coupling between infrastructure state and certificate renewal is the most common source of silent failure. When the trigger stops firing, no renewal attempt is made, no error is raised, and the certificate continues aging toward expiry without any indication that the pipeline has stopped.

### The Challenge Pipeline

For DNS-01 challenges the client must be able to write a TXT record to the domain's DNS before the CA queries for it. In delegated configurations this is handled via a CNAME that points `_acme-challenge.<domain>` to an endpoint controlled by the ACME client. The client writes the token to that endpoint, the CA follows the CNAME and finds it.

This pipeline has multiple components that can fail independently: the CNAME must exist and be correct, the ACME client must have write access to the delegation endpoint, the token must be written before the CA queries, and the CA must be able to resolve the endpoint. Any break in this chain results in a failed challenge. If the failure is not surfaced to the operator, the certificate ages toward expiry with no renewal.

### Observability

Most certificate automation is designed to be invisible when working correctly. This is a feature until it becomes a liability. A system that only produces output on failure provides no signal that distinguishes normal operation from a stuck state. An ACME client that last ran successfully 60 days ago looks identical to one that has been silently failing for 60 days — until the certificate expires.

The absence of a success signal is not the same as the absence of a failure signal. Operators who have not explicitly instrumented their renewal pipeline have no way of knowing which state they are in.

---

## DNS and CA Configuration Failure Modes

Beyond the renewal trigger and challenge pipeline, a class of failures exists at the DNS and CA policy layer that is often overlooked during initial setup and only discovered when renewal fails. These failures are distinct from infrastructure state issues — they are configuration problems that silently block the CA from validating domain ownership regardless of whether the ACME client is functioning correctly.

### CAA Records

Certification Authority Authorization is a DNS record type that allows a domain owner to declare which certificate authorities are permitted to issue certificates for their domain. A CAA record restricting issuance to a specific CA — for example a commercial CA used for other certificates — will cause Let's Encrypt or any other unlisted CA to refuse issuance, regardless of whether the ACME challenge succeeds.

CAA records are easy to introduce accidentally. A security policy change, a DNS audit, or a migration from one CA to another can result in a CAA record that blocks the automated renewal path without any immediate visible effect. The block only manifests at the next renewal attempt — which may be weeks or months later. Automated renewal systems should verify CAA policy as part of their pre-renewal checks and alert if the configured CA is not listed as an authorised issuer.

### DNSSEC Misconfiguration

DNSSEC adds cryptographic signing to DNS responses, allowing resolvers to verify that records have not been tampered with in transit. When DNSSEC is correctly configured it is transparent to certificate issuance. When it is misconfigured — invalid signatures, expired signing keys, incorrect DS records at the parent zone — it causes resolvers to return `SERVFAIL` for queries against the domain, which the CA interprets as a DNS failure and refuses to validate.

DNSSEC misconfigurations are particularly dangerous because they can be introduced by routine DNS operations — key rotation, zone transfers, registrar changes — and affect all DNS queries to the domain, not just certificate-related ones. A DNSSEC validation failure blocks certificate renewal but may not produce obvious symptoms in application traffic if resolvers fall back gracefully. Regular DNSSEC chain validation using external tooling is a necessary operational control for any domain using both DNSSEC and automated certificate issuance.

### DNS Propagation Delays

DNS-01 challenges are time-sensitive. The CA queries for the TXT record after the ACME client signals readiness. If the record has not propagated to the nameservers the CA queries from — which may be geographically distributed — the challenge fails. This is most likely to occur when DNS TTLs are long, when the record is written to a primary nameserver that replicates slowly to secondaries, or when the ACME client signals readiness too quickly after writing the record.

Well-designed ACME clients introduce a propagation delay after writing the challenge record and poll for consistency across authoritative nameservers before signalling readiness. Systems that do not include this logic are susceptible to intermittent challenge failures that are difficult to reproduce and easy to misdiagnose.

### CNAME Chaining and Delegation Errors

DNS-01 challenges can be handled via CNAME delegation — a record at `_acme-challenge.<domain>` points to an endpoint controlled by the ACME client, which writes the token there. This pattern is widely used in managed platforms and allows the ACME client to handle the challenge without requiring direct write access to the domain's DNS.

This delegation introduces its own failure modes. The CNAME must point directly to the endpoint — chains of CNAMEs that pass through intermediate records are not reliably followed by all CA resolvers and can cause challenge failures that are difficult to diagnose. The delegation endpoint must be reachable and must return the correct TXT record at the time the CA queries. A CNAME that points to a decommissioned or unreachable endpoint will cause all subsequent renewal attempts to fail silently until the delegation is corrected.

### Let's Encrypt Rate Limits

Let's Encrypt enforces rate limits on certificate issuance per registered domain — currently 50 certificates per domain per week. In environments with many subdomains, aggressive retry logic on renewal failures, or automated systems that issue certificates at scale, this limit can be reached. Once hit, no new certificates can be issued for the affected domain until the weekly window resets, regardless of whether the underlying issue has been resolved.

Rate limit exhaustion is a compounding failure. A misconfiguration that causes repeated failed renewal attempts consumes rate limit budget without producing a certificate. When the issue is eventually resolved, the domain may be rate-limited and unable to issue even if the ACME flow is now healthy. Systems that retry aggressively on failure without backoff are particularly at risk. Renewal systems should implement exponential backoff, cap retry frequency, and alert on rate limit proximity before it becomes a blocking condition.

---

## The Blast Radius of Expiry

Certificate expiry in isolation is a recoverable event. The harder problem is what happens in the window between expiry and remediation, and what the remediation itself introduces.

### Emergency CA Rotation

When a certificate expires and the normal renewal path is broken, the fastest resolution is often to manually source a certificate from a different CA and deploy it. This resolves the expiry but introduces a new dependency: clients must trust the new CA's chain.

In standard HTTPS deployments this is usually transparent — browsers ship with broad CA trust bundles and the rotation goes unnoticed. In environments that use mutual TLS, explicit CA pinning, or custom trust stores, a CA rotation is a breaking change. Clients configured to trust only the original CA will reject the new certificate and fail the handshake. The remediation of the expiry becomes a new incident.

This is the blast radius pattern: a contained failure — certificate expiry — is widened by the response to it because the system was not designed to absorb a CA change gracefully.

### mTLS Environments

Mutual TLS adds a second certificate dependency to every connection. In mTLS both the client and the server present certificates, and both sides validate the other against a trusted CA list. A server certificate change affects every client simultaneously. If clients have not been configured to trust the new CA chain, the impact is total — no client can connect until either the certificate is reverted or every client's trust store is updated.

This makes CA diversity in client trust stores a first-class reliability requirement in mTLS environments. It cannot be addressed reactively during an incident because the coordination required — updating trust stores across every client — is too slow to serve as a remediation path.

---

## Designing for Resilience

Treating certificate renewal as a reliability problem rather than a configuration problem changes what the system needs to look like. The following design principles address the failure modes identified above.

### Monitor the Pipeline, Not Just the Expiry Date

Alerting on certificate expiry is a last resort signal — by the time it fires the pipeline has already been broken for weeks. More useful signals are upstream: did the renewal client attempt renewal in the expected window, did the challenge succeed, when did the last successful issuance occur. A certificate with 40 days of validity remaining that was last renewed 55 days ago is a signal that the pipeline is broken — the expiry date just has not arrived yet.

Effective monitoring for certificate renewal looks like:

- Time since last successful renewal, alerting if it exceeds the expected interval
- Challenge success and failure rates, alerting on consecutive failures
- Explicit health checks on the ACME client and its dependencies
- Verification that the deployed certificate matches the expected issuer and expiry

### Decouple Renewal from Service Health

Renewal eligibility should not be gated on the full operational health of the service the certificate protects. A degraded service that cannot renew its certificate is in a worse state than a degraded service with a valid certificate. Wherever possible, certificate renewal should be treated as an independent process that runs regardless of whether the service it serves is fully healthy.

### Maintain a Fallback Certificate

A pre-provisioned certificate from a secondary CA, kept current and deployable, converts a hard availability failure into a planned failover. The operational requirement is that the fallback certificate is rotated on its own schedule — it provides no value if it has also expired when needed.

The more important requirement is that clients are configured to trust both CA chains before the fallback is ever needed. A fallback certificate from a CA that clients do not trust is not a fallback — it is a second failure waiting to happen. CA trust configuration for clients is a proactive concern, not a reactive one.

### Document and Test the Manual Path

Automated systems fail. When they do, operators need a manual path they have executed before. A runbook that describes how to manually trigger a renewal, verify a challenge, and deploy a certificate — tested periodically in non-incident conditions — is the difference between a 15-minute recovery and a multi-hour incident. The manual path should not be discovered for the first time under pressure.

### Treat Renewal as Infrastructure

Certificate renewal is not a set-and-forget configuration task. It is a recurring operational process that depends on multiple systems working correctly in sequence. It deserves the same infrastructure investment as any other critical dependency: redundancy, monitoring, alerting, documented recovery procedures, and periodic testing.

---

## Conclusion

Automated certificate management is a genuine improvement over manual rotation. It removes a class of human error and scales to environments where manual processes are not feasible. But automation does not eliminate the failure mode — it relocates it. The question shifts from whether someone remembered to renew the certificate to whether the automated system is in a state where it can.

The organisations that avoid certificate-related outages are not the ones with the most sophisticated ACME clients. They are the ones that have treated renewal as a system with failure modes worth designing around — with observability into the pipeline, redundancy at the CA layer, and clients that can absorb a CA rotation without it becoming an incident in its own right.

Certificate expiry is predictable. Outages caused by it are not inevitable.
