# TunnelGPT MCP Core

Project-scoped file tools, confirmed writes and bounded MCP transport for local AI workflows.

[![Core checks](https://github.com/carlosrodera/tunnelgpt-mcp-core/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/carlosrodera/tunnelgpt-mcp-core/actions/workflows/ci.yml)
[MIT license](LICENSE) · [TunnelGPT](https://www.tunnelgpt.com) · Built by [Carlos Rodera](https://github.com/carlosrodera)

Give an MCP integration access to a chosen project folder, with explicit limits on what it can read and change. This is the open-source core used by TunnelGPT, the desktop application that connects local projects to ChatGPT.

Use it to build project file tools, inspect the implementation behind TunnelGPT, or contribute improvements to the shared core.

## What is included

| Component | What it does |
| --- | --- |
| Path authorization | Resolves paths inside configured roots, applies deny rules, and supports rejecting symlinks and hard links. |
| File tools | Reads and searches text, walks project files, and applies bounded file operations. |
| Confirmed writes | Previews changes and binds confirmation tokens to the proposed operation. Read-only mode refuses writes. |
| MCP protocol | Message framing, discovery, header validation and protocol adapters. |
| Local transport | HTTP over a Unix socket, with limits on request size, concurrent work, queue length and timeouts. |

The library leaves authentication, user approval, process/container isolation and remote tunnel setup to the host application. A local socket does not establish a ChatGPT connection by itself.

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

The example exposes `read_project_file` for that folder. In a second terminal:

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

Install the first release from its immutable commit:

```sh
npm install --save-exact --ignore-scripts \
  https://github.com/carlosrodera/tunnelgpt-mcp-core/archive/761ac168655099fa0c67e69e3474783abf7c93de.tar.gz
```

This is `@tunnelgpt/mcp-core` version `0.1.0`, also tagged `v0.1.0`. The package includes compiled JavaScript and TypeScript declarations. It is currently distributed through GitHub; the command above does not depend on an npm registry publication.

Exports include `PathAuthorizer`, `SafeReader`, `AtomicWriter`, `SignedTokenCodec`, `UnixHttpMcpServer` and `createCoreMcpHandler`. The [entry point](src/index.ts) lists the public exports. Keep the resolved integrity in your lockfile when updating.

## Core and desktop application

This repository is licensed under MIT. You can study, modify, use and redistribute this code under that license.

[TunnelGPT](https://www.tunnelgpt.com) adds the commercial desktop interface, guided setup, native integration, account and license services. Those components are maintained separately. The current MIT scope covers the code in this repository; it does not promise that every future commercial feature will be published here.

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

Include a regression test for behavior changes and rebuild `dist` when changing TypeScript. CI checks types, functional tests, reproducible build output, dependency licenses and CodeQL. Keep proposals focused on the public core and use sample projects with no credentials or private files.

Created and maintained by [Carlos Rodera](https://github.com/carlosrodera). Feedback and contributions help shape the project.

## License

[MIT](LICENSE). Original copyright notices are retained. Dependency notices are listed in [THIRD_PARTY_NOTICES](THIRD_PARTY_NOTICES).
