---
layout: ../../layouts/CaseStudy.astro
title: HTTP Request Smuggling via Transfer_Encoding Header Bypass — Envoy Header Normalization Gap
client: Security Research
date: 2026
tags: [HTTP Smuggling, CL+TE, Transfer-Encoding, Envoy, WAF, HTTP/1.1, Security Research]
summary: Identified an uninspected HTTP request smuggling vector on an Envoy based cloud reverse proxy where the Transfer_Encoding underscore variant bypasses dedicated CL+TE smuggling prevention controls that block 42+ other obfuscation variants, with a working proof of concept demonstrating end to end bypass.
---

## The Problem

While investigating a customer potentially impacted by an HTTP smuggling attack with a cloud WAF in front, I began systematically testing Transfer-Encoding obfuscation variants against an Envoy based reverse proxy platform. Envoy performs dedicated inspection of CL+TE combinations — requests containing both a Transfer-Encoding and Content-Length header are blocked at the gateway level with a 400 response regardless of WAF configuration state.

The question driving the investigation was whether this protection was comprehensive or whether obfuscation variants existed that could bypass it.

## What I Did

### Systematic Obfuscation Testing

I tested 42 Transfer-Encoding obfuscation variants against Envoy including invalid values, casing mutations, whitespace variations, duplicate headers, and folded headers. All 42 were blocked with a 400 response at the gateway level with no WAF configuration required. This confirmed Envoy has dedicated security logic specifically handling Transfer-Encoding in the context of smuggling prevention, operating beyond strict RFC compliance.

### Identifying the Bypass

During testing I sent a request using `Transfer_Encoding: chunked` — the header name with an underscore rather than a hyphen — combined with `Content-Length`. Unlike every other variant tested, this request was not blocked. Envoy forwarded it to the backend untouched.

The underscore variant is not a valid HTTP/1.1 Transfer-Encoding header under normal parsing rules. However Envoy's security inspection performs string matching on the hyphen variant specifically. The underscore variant falls outside this inspection scope and is treated as an unknown generic header rather than a Transfer-Encoding directive. The backend, depending on its parser implementation, may interpret it as a valid Transfer-Encoding instruction — creating the classic CL+TE ambiguity that enables request smuggling.

### Envoy Header Handling Context

Envoy's default behavior allows headers with underscores and treats them as custom headers. This is configurable via the `headers_with_underscores_action` setting in `HttpProtocolOptions`. By default Envoy does not normalize underscore based header names to their hyphen equivalents, meaning a header named `Transfer_Encoding` and a header named `Transfer-Encoding` are treated as entirely separate and unrelated headers at the protocol level.

This is the root of the gap. The CL+TE inspection logic is aware of `Transfer-Encoding` and actively sanitizes obfuscation attempts against it. But because `Transfer_Encoding` is processed as a distinct unknown header rather than a normalized representation of the same header, it bypasses the inspection pass entirely and is forwarded downstream where a backend parser may interpret it differently.

### Proof of Concept

I constructed and executed a proof of concept demonstrating the bypass end to end:

```bash
curl https://[target] \
  --http1.1 \
  -H "Transfer_Encoding: chunked" \
  -H "Content-Length: 6" \
  -d $'0\r\n\r\nG' \
  -v 2>&1
```

The request was forwarded through Envoy with `Transfer_Encoding: chunked` intact in the headers reaching the backend. The backend processed both the legitimate request and the smuggled content confirming the bypass is functional and not theoretical.

### Why RFC Compliance Is Not the Boundary

RFC 7230 does not prohibit underscore containing header names — but neither does it permit the 42 other obfuscation variants already blocked by Envoy. Values like `xchunked`, casing mutations, and whitespace variants are equally outside RFC compliance and equally non-standard, yet all are blocked without exception. This confirms that RFC compliance is not the inspection boundary being used.

Transfer-Encoding is also not analogous to an arbitrary custom header. It is a protocol level header with a specific role in HTTP/1.1 message framing and a well documented history as the primary vehicle for request smuggling attacks. The gap is specifically that Envoy's header normalization does not extend to the security inspection pass for this header — underscore and hyphen variants are not treated as equivalent representations in the context of smuggling detection.

## The Customer Visibility Problem

The more significant issue beyond the technical gap is that customers have no way of knowing this limitation exists. Envoy is blocking 42+ Transfer-Encoding obfuscation variants by default creates a reasonable expectation that CL+TE smuggling prevention is comprehensive. Without documentation of this boundary customers cannot make informed decisions about whether additional mitigation at the application layer is required.

This is compounded by the fact that the bypass is simple to execute, requires no special tooling, and produces no error or log signal at the gateway level that would alert defenders to its use.

## Outcome

- Identified a functional bypass of dedicated CL+TE smuggling prevention on an Envoy instance
- Demonstrated the bypass with a working end to end proof of concept
- Established the root cause as a header normalization gap in Envoy's security inspection logic where underscore and hyphen variants of Transfer-Encoding are not treated as equivalent
- Documented the customer visibility gap — the limitation is undocumented and customers relying on the envoys's default smuggling prevention may not be aware manual mitigation is required for this variant
- Investigation ongoing in relation to a customer potentially impacted by this vector