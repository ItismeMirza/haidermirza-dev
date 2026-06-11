---
layout: ../../layouts/CaseStudy.astro
title: HTTP/2 Connection Pool Race Condition — Root Cause Identification and Resolution
client: Large Enterprise
date: 2026
tags: [HTTP/2, Cloud Reverse Proxy, Connection Pooling, Packet Analysis, Envoy, TCP, RFC 7540]
summary: Identified and resolved intermittent 503 upstream reset errors affecting external users on a cloud virtual appliance reverse proxy deployment through deep packet capture analysis, Envoy source code review, and HTTP/2 protocol specification research.
---

## The problem

An enterprise customer was experiencing intermittent 503 errors with the signature `upstream_reset_before_response_started{remote_refused_stream_reset}` on traffic routed through the reverse proxy to a backend file transfer platform. The error rate was consistent regardless of traffic volume and only affected external users traversing the reverse proxy — internal users on the same backend were completely unaffected.

Initial escalation paths were unable to identify the root cause. Theories ranged from concurrent stream limits to upstream load balancer configuration issues. None were supported by the packet level evidence.

## What I did

### Starting with only request logs

Initially the only visibility available was the reverse proxy access logs. Before requesting packet captures I analysed the traffic pattern in the logs and quickly identified that the error rate remained consistent regardless of traffic volume — errors occurred at the same frequency during high traffic and low traffic periods alike. This ruled out an upstream dependency issue or backend overload as the root cause. A dependency problem would correlate with traffic spikes. The consistent pattern regardless of load pointed to a timing based issue rather than a capacity one. This early observation shaped the entire investigation and directed focus toward connection lifecycle behavior rather than infrastructure capacity.

### Capturing and correlating the evidence

I requested packet captures from the backend nodes and correlated specific 503 request IDs from the reverse proxy access logs to exact timestamps in the captures. The captures were taken directly on the backend application nodes giving full visibility into the connection lifecycle.

```
Wireshark filter used to isolate the failing connections:
ip.addr == <RE-node-1> || ip.addr == <RE-node-2>
```

### Identifying the race condition

The captures revealed that the reverse proxy opens multiple HTTP/2 connections to the backend simultaneously as part of connection pool initialisation. The backend has a 75 second idle connection timeout and closes connections with a TCP FIN after 75 seconds of inactivity.

Because both connections opened at the same time they hit the 75 second idle timeout simultaneously. At the exact moment the backend sent a FIN, the reverse proxy tried to send a new request on that connection. Both events crossed in transit within milliseconds of each other. The backend responded with a RST because it received data on a connection it had already committed to closing. the reverse proxy logged a 503.

The correlation was exact — FINs in the pcap at `10:09:47` matched 503s in the reverse proxy access logs at `10:09:47`.

### Reviewing the Envoy source code

To understand why the HTTP idle timeout workaround did not resolve the issue I reviewed the cloud virtual appliance Envoy fork source code. I found that:

- `onIdleTimeout` in `codec_client.h` calls `close()` directly without transitioning to `Draining` state first
- `onConnectionDurationTimeout` in `conn_pool_base.cc` correctly transitions to `Draining` before closing
- The HTTP idle timeout setting applies to HTTP/1.1 only and does not affect HTTP/2 connections per the origin pool documentation

### Applying the RFC

Per RFC 7540 Section 6.8 a server attempting graceful HTTP/2 connection shutdown should send an initial GOAWAY frame with at least one round trip time of lead time before closing. The RTT in this environment was approximately 25-35ms. The backend sent no GOAWAY — only an immediate FIN — giving the reverse proxy zero lead time to drain the connection.

### Refuting incorrect theories

Multiple engineers across two escalation paths theorised the AWS NLB was responsible. I refuted this using:

1. Packet capture evidence showing the FIN originating from the backend node IP, not the NLB
2. AWS documentation confirming NLB silently drops idle connections without sending FIN or RST
3. Customer confirmation that captures were taken on the backend application nodes directly

## Outcome

- Root cause conclusively identified through packet capture analysis and RFC review
- Confirmed the reverse proxy is operating correctly per the HTTP/2 specification
- Established that the fix requires the backend to implement RFC 7540 Section 6.8 graceful connection shutdown
- Clarified that the HTTP idle timeout setting does not apply to HTTP/2, closing a gap in the product documentation
- Case formally closed on the reverse proxy side with full evidence package provided to the customer for escalation to their backend vendor
- Finding flagged internally for engineering review of HTTP/2 connection pool idle timeout handling

### Investigating broader ecosystem impact

Out of curiosity I investigated how other common HTTP/2 client libraries handle idle connection timeouts to understand whether this was an isolated issue or a wider pattern. I found that Go's standard net/http HTTP/2 implementation also does not handle idle timeouts gracefully — connections are closed without a preceding GOAWAY frame, creating the same race condition potential as described in this case. I submitted this finding on GitHub for the Go team to review.

This suggests the problem is not unique to any single implementation and points to a broader gap in how HTTP/2 idle connection lifecycle is handled across the industry when the origin does not send GOAWAY.
