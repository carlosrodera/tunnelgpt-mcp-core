export interface SecretDetection {
    readonly type: string;
    readonly line: number;
}
const TOKEN_PATTERNS: readonly {
    readonly type: string;
    readonly pattern: RegExp;
}[] = [
    { type: "private_key", pattern: /-----BEGIN (?:RSA |EC |OPENSSH |DSA |PGP )?PRIVATE KEY-----/u },
    { type: "aws_access_key", pattern: /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/u },
    { type: "openai_api_key", pattern: /\bsk-[A-Za-z0-9_-]{20,}\b/u },
    { type: "github_token", pattern: /\bgh[opusr]_[A-Za-z0-9]{20,}\b/u },
    { type: "slack_token", pattern: /\bxox[baprs]-[A-Za-z0-9-]{20,}\b/u },
    { type: "jwt", pattern: /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/u },
];
const ASSIGNMENT_PREFIX = /\b(?:api[_-]?key|secret|password|passwd|token|private[_-]?key)\b\s*[:=]/iu;
const UNQUOTED_LITERAL_PREFIX = /^[A-Za-z0-9_+/=:-]+/u;
const TEMPLATE_PLACEHOLDER = /^\$\{[^}\r\n]+\}$/u;
const DELIMITED_PLACEHOLDER = /^(?:<[^>\r\n]+>|\[[^\]\r\n]+\])$/u;
const NAMED_PLACEHOLDER = /^(?:(?:example|dummy|placeholder|changeme|sample|redacted)(?:[_:/-](?:api[_-]?key|secret|password|token|value|here))*|your[_:/-](?:api[_-]?key|secret|password|token)(?:[_:/-]here)?|test[_:/-]canary(?:[_:/-](?:do[_-]?not[_-]?use|placeholder|value))?|x{5,})$/iu;
function isExplicitPlaceholder(candidate: string): boolean {
    return TEMPLATE_PLACEHOLDER.test(candidate)
        || DELIMITED_PLACEHOLDER.test(candidate)
        || NAMED_PLACEHOLDER.test(candidate);
}
function isLiteralSuffix(value: string): boolean {
    let suffix = value.trimStart();
    if (suffix.startsWith(',') || suffix.startsWith(';'))
        suffix = suffix.slice(1).trimStart();
    return suffix.length === 0 || suffix.startsWith('//') || suffix.startsWith('#');
}
function assignedCredentialLiteral(line: string): string | undefined {
    const assignment = ASSIGNMENT_PREFIX.exec(line);
    if (assignment === null)
        return undefined;
    // Consume each region separately. Adjacent optional whitespace quantifiers
    // backtrack quadratically when a long, untrusted assignment is malformed.
    const rightHandSide = line.slice(assignment.index + assignment[0].length).trim();
    const quote = rightHandSide[0];
    let candidate: string | undefined;
    let literalEnd = 0;
    if (quote === '"' || quote === "'" || quote === '`') {
        let end = 1;
        for (; end < rightHandSide.length; end += 1) {
            if (rightHandSide[end] === '\\') {
                end += 1;
            } else if (rightHandSide[end] === quote) {
                break;
            }
        }
        if (end >= rightHandSide.length)
            return undefined;
        candidate = rightHandSide.slice(1, end);
        literalEnd = end + 1;
    } else {
        candidate = UNQUOTED_LITERAL_PREFIX.exec(rightHandSide)?.[0];
        literalEnd = candidate?.length ?? 0;
    }
    if (!isLiteralSuffix(rightHandSide.slice(literalEnd)))
        return undefined;
    if (candidate === undefined || candidate.length < 12 || isExplicitPlaceholder(candidate))
        return undefined;
    return candidate;
}
export function detectSecretContent(text: string): SecretDetection | undefined {
    const lines = text.split(/\r?\n/u);
    for (let index = 0; index < lines.length; index += 1) {
        const line = lines[index]!;
        for (const item of TOKEN_PATTERNS) {
            const match = item.pattern.exec(line)?.[0];
            if (match !== undefined)
                return { type: item.type, line: index + 1 };
        }
        if (assignedCredentialLiteral(line) !== undefined) {
            return { type: "credential_assignment", line: index + 1 };
        }
    }
    return undefined;
}
export function redactPotentialSecrets(value: string): string {
    let output = value;
    for (const { pattern } of TOKEN_PATTERNS)
        output = output.replace(new RegExp(pattern.source, `${pattern.flags}g`), "[REDACTED]");
    return output.split(/(\r?\n)/u).map((line) => {
        const candidate = assignedCredentialLiteral(line);
        return candidate === undefined ? line : line.replace(candidate, "[REDACTED]");
    }).join("");
}
