---
layout: ../../layouts/CaseStudy.astro
title: Zero Trust Network Architecture for F5 BIG-IP Fleet
client: F5
date: 2024
tags: [Zero Trust, BIG-IP, mTLS, Kubernetes, Access Policy Manager]
summary: Redesigned the trust model for a large-scale F5 BIG-IP deployment — eliminating implicit east-west trust and enforcing mutual TLS across the data plane.
---

## The problem

The existing deployment treated internal network traffic as implicitly trusted. Services behind the BIG-IP load balancers could communicate freely once inside the perimeter — a flat network model that had grown organically over years.

As the environment scaled and compliance requirements tightened, this became untenable. A single compromised workload could move laterally with minimal friction.

## What I did

### Mapping the trust surface

Before changing anything, I mapped every service-to-service communication path across the fleet. This wasn't just network diagrams — it meant tracing actual traffic through iRules, virtual servers, and pool members to understand what was genuinely needed versus what was incidentally permitted.

### Designing the control plane changes

I restructured the BIG-IP Access Policy Manager (APM) policies to enforce identity-based access at the point of ingress. Rather than IP-based ACLs, services authenticate with short-lived certificates issued by an internal CA.

```bash
# Example: enforcing client cert validation on a virtual server
tmsh modify ltm virtual /Common/api-internal \
  profiles add { clientssl-mutual { context clientside } }
```

### Enforcing mTLS at the data plane

East-west traffic between pools was re-routed through a service mesh sidecar pattern, with BIG-IP acting as the policy enforcement point at the boundary. Internal services that couldn't be immediately migrated were isolated into trust zones with explicit allowlists.

### Incremental rollout

Zero trust migrations break things if you flip a switch. I built a shadow mode — logging what *would* be denied before enforcing it — which let us validate policy correctness over two weeks before cutting over.

## Outcome

- Eliminated implicit east-west trust across the fleet
- mTLS enforced on all service-to-service traffic within scope
- Zero production incidents during rollout
- Compliance posture significantly improved ahead of audit

---

*Replace this content with your real case study. Keep the structure: problem → approach → outcome.*
