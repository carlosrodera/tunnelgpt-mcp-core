# TunnelGPT MCP Core

One local project folder, file tools and a bounded MCP socket. That is the open-source core.

[![Core checks](https://github.com/carlosrodera/tunnelgpt-mcp-core/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/carlosrodera/tunnelgpt-mcp-core/actions/workflows/ci.yml)
[MIT license](LICENSE) · [TunnelGPT](https://www.tunnelgpt.com) · Built by [Carlos Rodera](https://github.com/carlosrodera)

If you want to wire your own connection instead of using the TunnelGPT application, this package is the starting point: give an MCP client access to **one project directory** over a private Unix socket, with explicit limits on what it can read and change.

This is not the desktop app, not a multi-project router, and not a ChatGPT tunnel. A local socket does not establish a remote connection by itself.

## What is included

| Component | What it does |
| --- | --- |
| Path authorization | Resolves paths inside the configured project folder, applies deny rules, and supports rejecting symlinks and hard links. |
| File tools | Reads and searches text, walks project files, and applies bounded text file operations. |
| Confirmed writes | Previews changes and binds confirmation tokens to the proposed operation. Read-only mode refuses writes. |
| MCP protocol | Message framing, discovery, header validation and protocol adapters. |
| Local transport | HTTP over a Unix socket, with limits on request size, concurrent work, queue length and timeouts. |

## What is not included

The TunnelGPT **application** stays private. It is not published here:

- Desktop UI, accounts, licenses and guided setup
- Remote tunnel and ChatGPT connector
- One route per project, and switching between several local projects
- Extra local MCP servers and product-only file transfer

Authentication, user approval, process isolation and remote tunnel setup belong to the host you build, or to the TunnelGPT application if you use that instead.

## Try it locally

Requires Node.js **22.12 or later**. The Unix-socket example is intended for macOS and Linux.

```sh
git clone https://github.com/carlosrodera/tunnelgpt-mcp-core.git
cd tunnelgpt-mcp-core
npm ci --ignore-scripts
npm run build
mkdir -p /tmp/tunnelgpt-core-demo
printf 'Hello from a local project.\n' > /tmp/tunnelgpt-core-demo/hello.txt
node examples/project.mjs /tmp/tunnelgpt-core-demo /tmp/tunnelgpt-core-demo/mcp.sock
```

The example exposes `read_project_file` for **that one folder**. In a second terminal:

```sh
curl --unix-socket /tmp/tunnelgpt-core-demo/mcp.sock \
  http://localhost/mcp \
  -H 'Content-Type: application/json' \
  -H 'Accept: application/json, text/event-stream' \
  -H 'MCP-Protocol-Version: 2025-11-25' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"read_project_file","arguments":{"path":"hello.txt"}}}'
```

Stop the server with **Ctrl+C**. Restart it with `--edit` to also expose `create_project_file`. Its first call returns a proposal. Applying it requires the same arguments, its confirmation token and `confirmed: true`. The host must obtain the user's approval before confirming a write.

See [the complete example](examples/project.mjs) for configuration and tool registration, and [the tests](tests/core.test.mjs) for executable read, write and transport cases.

## Use it as a dependency

Install `@tunnelgpt/mcp-core` **0.4.0** from an immutable commit on `main` after this release lands:

```sh
npm install --save-exact --ignore-scripts \
  https://github.com/carlosrodera/tunnelgpt-mcp-core/archive/v0.4.0.tar.gz
```

The package includes compiled JavaScript and TypeScript declarations. It is currently distributed through GitHub; the command above does not depend on an npm registry publication.

Exports include `PathAuthorizer`, `SafeReader`, `AtomicWriter`, `SignedTokenCodec`, `UnixHttpMcpServer` and `createCoreMcpHandler`. The [entry point](src/index.ts) lists the public exports. Keep the resolved integrity in your lockfile when updating.

The authorizer can accept more than one folder because that is how a host names roots. The gift, the example and the intended DIY setup are still **one project, one socket**. Routing several projects, each with its own remote connector, is product work.

## Core and application

This repository is licensed under MIT. You can study, modify, use and redistribute this code under that license.

[TunnelGPT](https://www.tunnelgpt.com) is the commercial application built on top of this core. The MIT scope is the code in this repository. It does not promise that product features will be published here.

TunnelGPT is independent software and is not affiliated with, sponsored by or endorsed by OpenAI.

## Contribute

Issues and pull requests are welcome. Useful contributions include reproducible bugs, clearer examples, path-boundary tests, protocol interoperability and improvements to the public API.

Before opening a pull request, run:

```sh
npm ci --ignore-scripts
npm run check
node scripts/verify-package.mjs
npm audit --audit-level=low
```

Include a regression test for behavior changes and rebuild `dist` when changing TypeScript. CI checks types, functional tests, reproducible build output, dependency licenses and CodeQL. Keep proposals inside this core. Do not add desktop, billing, multi-project distribution, remote tunnels or product-only transfer.

Created and maintained by [Carlos Rodera](https://github.com/carlosrodera).

## License

[MIT](LICENSE). Original copyright notices are retained. Dependency notices are listed in [THIRD_PARTY_NOTICES](THIRD_PARTY_NOTICES).
