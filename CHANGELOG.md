# Changes

## 0.4.0

- Restore the MIT core boundary. This repository is the DIY one-project MCP core: path authorization, text file tools, confirmed writes, protocol framing and HTTP over a Unix socket.
- Remove binary file transfer, resumable upload staging, durable receipts and checkpoint language. Those belong to the TunnelGPT application, not this gift.
- Keep bounded long-line pagination (0.2.0) and the credential-scanner ReDoS fix from 0.3.1.

## 0.3.1

- Fix three CodeQL `js/polynomial-redos` findings in credential assignment scanning. Prefixes, quoted values and comment suffixes are consumed separately, including escaped quotes, without overlapping optional whitespace groups.
- Add a regression for three malformed assignments containing 120,000 spaces.

The transfer and staging APIs that landed beside this fix are withdrawn in 0.4.0.

## 0.2.0

- Read bounded fragments of long UTF-8 lines using Unicode code point columns. Continuations include `nextStartLine` and `nextStartColumn`; consumers must carry both to avoid skipping text. Full-file hashing and identity checks remain in place.
- Long lines outside a requested range no longer prevent reading that range. Credential detection scans overlapping chunks before returning fragments, including credential markers split across a page boundary.
- `.gitignore` no longer authorizes or denies MCP file access. `.mcpignore` remains the explicit exclusion source, and directory exclusions apply to direct descendant reads as well as directory listings. Protected credential paths and root boundaries are unchanged.

Consumers should bind pagination cursors to the returned file hash. A cursor is not permission to continue reading a different version of the file.
