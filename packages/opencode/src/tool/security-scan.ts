import z from "zod"
import { Tool } from "./tool"
import { Instance } from "../project/instance"
import { Ripgrep } from "../file/ripgrep"
import DESCRIPTION from "./security-scan.txt"
import path from "path"
import { Log } from "../util/log"

const log = Log.create({ service: "security-scan" })

interface VulnerabilityPattern {
  id: string
  title: string
  cwe: string
  owasp: string
  severity: "critical" | "high" | "medium" | "low" | "info"
  confidence: "high" | "medium" | "low"
  pattern: string
  languages: string[]
  description: string
  remediation: string
}

const VULNERABILITY_PATTERNS: VulnerabilityPattern[] = [
  // === INJECTION FLAWS (OWASP A03:2021) ===
  {
    id: "SQL-INJ-001",
    title: "SQL Injection - String Concatenation in Query",
    cwe: "CWE-89",
    owasp: "A03:2021 Injection",
    severity: "critical",
    confidence: "high",
    pattern: `(query|execute|exec|raw)\\s*\\(\\s*["\`'].*\\$\\{`,
    languages: ["js", "ts", "tsx", "jsx"],
    description: "SQL query built using template literal interpolation, potentially allowing SQL injection attacks.",
    remediation: "Use parameterized queries or prepared statements instead of string interpolation.",
  },
  {
    id: "SQL-INJ-002",
    title: "SQL Injection - String Concatenation",
    cwe: "CWE-89",
    owasp: "A03:2021 Injection",
    severity: "critical",
    confidence: "high",
    pattern: `(query|execute|exec|raw)\\s*\\(\\s*["']\\s*SELECT.*\\+`,
    languages: ["js", "ts", "py", "java", "rb", "php"],
    description: "SQL query built with string concatenation, allowing potential SQL injection.",
    remediation: "Use parameterized queries or an ORM with proper escaping.",
  },
  {
    id: "SQL-INJ-003",
    title: "SQL Injection - Python f-string/format",
    cwe: "CWE-89",
    owasp: "A03:2021 Injection",
    severity: "critical",
    confidence: "high",
    pattern: `(execute|cursor\\.execute|query)\\s*\\(\\s*f["']`,
    languages: ["py"],
    description: "SQL query using Python f-string formatting, vulnerable to SQL injection.",
    remediation: "Use parameterized queries with %s or ? placeholders.",
  },
  {
    id: "CMD-INJ-001",
    title: "Command Injection - exec/spawn with variable",
    cwe: "CWE-78",
    owasp: "A03:2021 Injection",
    severity: "critical",
    confidence: "high",
    pattern: `(exec|execSync|spawn|spawnSync|system|popen)\\s*\\(\\s*[^"'\`]*(\\+|\\$\\{|\\.format|%s)`,
    languages: ["js", "ts", "py", "rb"],
    description: "System command execution with dynamic input, potentially allowing command injection.",
    remediation: "Use allowlists for commands, avoid shell execution, or use subprocess with array arguments.",
  },
  {
    id: "CMD-INJ-002",
    title: "Command Injection - Shell=True",
    cwe: "CWE-78",
    owasp: "A03:2021 Injection",
    severity: "high",
    confidence: "high",
    pattern: `subprocess\\.(call|run|Popen)\\(.*shell\\s*=\\s*True`,
    languages: ["py"],
    description: "Subprocess executed with shell=True, increasing command injection risk.",
    remediation: "Use shell=False and pass command as a list of arguments.",
  },
  {
    id: "XPATH-INJ-001",
    title: "XPath Injection",
    cwe: "CWE-643",
    owasp: "A03:2021 Injection",
    severity: "high",
    confidence: "medium",
    pattern: `(xpath|evaluate)\\s*\\(\\s*["\`'].*\\$\\{`,
    languages: ["js", "ts", "java", "py"],
    description: "XPath query with dynamic input interpolation, vulnerable to XPath injection.",
    remediation: "Use parameterized XPath queries or sanitize input before embedding in XPath expressions.",
  },
  {
    id: "LDAP-INJ-001",
    title: "LDAP Injection",
    cwe: "CWE-90",
    owasp: "A03:2021 Injection",
    severity: "high",
    confidence: "medium",
    pattern: `(ldap|search)\\s*\\(.*["\`']\\s*\\(.*\\$\\{`,
    languages: ["js", "ts", "py", "java"],
    description: "LDAP query with dynamic input, potentially vulnerable to LDAP injection.",
    remediation: "Sanitize and escape special LDAP characters in user input before constructing LDAP queries.",
  },
  {
    id: "NOSQL-INJ-001",
    title: "NoSQL Injection",
    cwe: "CWE-943",
    owasp: "A03:2021 Injection",
    severity: "high",
    confidence: "medium",
    pattern: `\\.(find|findOne|aggregate|update|delete)\\(\\s*\\{[^}]*\\$\\{`,
    languages: ["js", "ts"],
    description: "MongoDB/NoSQL query with template literal interpolation, potentially allowing NoSQL injection.",
    remediation: "Validate and sanitize input, use explicit query operators instead of dynamic object construction.",
  },

  // === XSS (OWASP A03:2021) ===
  {
    id: "XSS-001",
    title: "Cross-Site Scripting - innerHTML",
    cwe: "CWE-79",
    owasp: "A03:2021 Injection",
    severity: "high",
    confidence: "high",
    pattern: `\\.innerHTML\\s*=`,
    languages: ["js", "ts", "tsx", "jsx"],
    description: "Direct innerHTML assignment can lead to DOM-based XSS if the value contains user-controlled data.",
    remediation: "Use textContent for plain text, or sanitize HTML with DOMPurify before using innerHTML.",
  },
  {
    id: "XSS-002",
    title: "Cross-Site Scripting - document.write",
    cwe: "CWE-79",
    owasp: "A03:2021 Injection",
    severity: "high",
    confidence: "high",
    pattern: `document\\.write(ln)?\\s*\\(`,
    languages: ["js", "ts"],
    description: "document.write() can introduce XSS vulnerabilities when used with dynamic content.",
    remediation: "Use DOM manipulation methods (createElement, appendChild) instead of document.write().",
  },
  {
    id: "XSS-003",
    title: "Cross-Site Scripting - dangerouslySetInnerHTML",
    cwe: "CWE-79",
    owasp: "A03:2021 Injection",
    severity: "high",
    confidence: "medium",
    pattern: `dangerouslySetInnerHTML`,
    languages: ["jsx", "tsx", "js", "ts"],
    description: "React's dangerouslySetInnerHTML bypasses built-in XSS protections.",
    remediation: "Sanitize HTML content with DOMPurify before passing to dangerouslySetInnerHTML.",
  },
  {
    id: "XSS-004",
    title: "Cross-Site Scripting - eval()",
    cwe: "CWE-79",
    owasp: "A03:2021 Injection",
    severity: "critical",
    confidence: "high",
    pattern: `\\beval\\s*\\(`,
    languages: ["js", "ts", "py"],
    description: "eval() executes arbitrary code, creating severe XSS and code injection risks.",
    remediation: "Avoid eval() entirely. Use JSON.parse() for JSON data, or structured alternatives for dynamic execution.",
  },
  {
    id: "XSS-005",
    title: "Cross-Site Scripting - Unescaped Template Output",
    cwe: "CWE-79",
    owasp: "A03:2021 Injection",
    severity: "high",
    confidence: "medium",
    pattern: `\\{\\{\\{.*\\}\\}\\}|\\{!!.*!!\\}|<%[-=]?\\s*.*%>`,
    languages: ["html", "hbs", "ejs", "erb", "php"],
    description: "Unescaped template output can introduce XSS when rendering user-controlled data.",
    remediation: "Use escaped output delimiters ({{ }} instead of {{{ }}}) and sanitize all user inputs.",
  },

  // === BROKEN AUTHENTICATION (OWASP A07:2021) ===
  {
    id: "AUTH-001",
    title: "Hardcoded JWT Secret",
    cwe: "CWE-798",
    owasp: "A07:2021 Identification and Authentication Failures",
    severity: "critical",
    confidence: "high",
    pattern: `(jwt|jsonwebtoken)\\.(sign|verify)\\s*\\([^,]+,\\s*["'\`][^"'\`]{8,}["'\`]`,
    languages: ["js", "ts"],
    description: "JWT secret is hardcoded in source code, compromising token security.",
    remediation: "Store JWT secrets in environment variables or a secure secret management system.",
  },
  {
    id: "AUTH-002",
    title: "Weak Password Hashing - MD5/SHA1",
    cwe: "CWE-328",
    owasp: "A07:2021 Identification and Authentication Failures",
    severity: "high",
    confidence: "high",
    pattern: `(createHash|hashlib\\.)\\s*\\(\\s*["'](md5|sha1)["']`,
    languages: ["js", "ts", "py"],
    description: "MD5/SHA1 are cryptographically broken for password hashing.",
    remediation: "Use bcrypt, scrypt, or Argon2 for password hashing.",
  },
  {
    id: "AUTH-003",
    title: "Weak Password Hashing - Unsalted",
    cwe: "CWE-916",
    owasp: "A07:2021 Identification and Authentication Failures",
    severity: "high",
    confidence: "medium",
    pattern: `(createHash|hashlib\\.sha256|hashlib\\.sha512).*\\.update\\(.*password`,
    languages: ["js", "ts", "py"],
    description: "Password hashing without salt, vulnerable to rainbow table attacks.",
    remediation: "Use bcrypt, scrypt, or Argon2 which include automatic salting.",
  },

  // === SENSITIVE DATA EXPOSURE (OWASP A02:2021) ===
  {
    id: "CRYPTO-001",
    title: "Insecure Random Number Generation",
    cwe: "CWE-330",
    owasp: "A02:2021 Cryptographic Failures",
    severity: "medium",
    confidence: "high",
    pattern: `Math\\.random\\(\\)`,
    languages: ["js", "ts"],
    description: "Math.random() is not cryptographically secure and should not be used for security-sensitive operations.",
    remediation: "Use crypto.getRandomValues() or crypto.randomBytes() for security-sensitive random values.",
  },
  {
    id: "CRYPTO-002",
    title: "Insecure Cipher - DES/RC4",
    cwe: "CWE-327",
    owasp: "A02:2021 Cryptographic Failures",
    severity: "high",
    confidence: "high",
    pattern: `(createCipher|DES|RC4|rc4|des-ecb|des-cbc)`,
    languages: ["js", "ts", "py", "java"],
    description: "Using deprecated or insecure encryption algorithms (DES, RC4).",
    remediation: "Use AES-256-GCM or ChaCha20-Poly1305 for symmetric encryption.",
  },
  {
    id: "CRYPTO-003",
    title: "ECB Mode Encryption",
    cwe: "CWE-327",
    owasp: "A02:2021 Cryptographic Failures",
    severity: "high",
    confidence: "high",
    pattern: `(aes-.*-ecb|AES/ECB|MODE_ECB|ECB_MODE)`,
    languages: ["js", "ts", "py", "java", "go"],
    description: "ECB encryption mode does not provide semantic security, patterns in plaintext are visible in ciphertext.",
    remediation: "Use GCM or CBC mode with proper IV/nonce management.",
  },
  {
    id: "TLS-001",
    title: "TLS Certificate Verification Disabled",
    cwe: "CWE-295",
    owasp: "A02:2021 Cryptographic Failures",
    severity: "critical",
    confidence: "high",
    pattern: `(rejectUnauthorized\\s*:\\s*false|NODE_TLS_REJECT_UNAUTHORIZED\\s*=\\s*["']0|verify\\s*=\\s*False|InsecureSkipVerify\\s*:\\s*true)`,
    languages: ["js", "ts", "py", "go"],
    description: "TLS certificate verification is disabled, allowing man-in-the-middle attacks.",
    remediation: "Enable TLS certificate verification and use proper CA certificates.",
  },

  // === SECURITY MISCONFIGURATION (OWASP A05:2021) ===
  {
    id: "MISC-001",
    title: "Debug Mode Enabled in Production",
    cwe: "CWE-489",
    owasp: "A05:2021 Security Misconfiguration",
    severity: "medium",
    confidence: "medium",
    pattern: `(DEBUG\\s*=\\s*True|debug\\s*:\\s*true|enableDebug|setDebug\\(true\\))`,
    languages: ["py", "js", "ts", "java", "rb"],
    description: "Debug mode enabled, potentially exposing sensitive information and stack traces.",
    remediation: "Ensure debug mode is disabled in production configurations.",
  },
  {
    id: "MISC-002",
    title: "CORS Wildcard Configuration",
    cwe: "CWE-942",
    owasp: "A05:2021 Security Misconfiguration",
    severity: "medium",
    confidence: "high",
    pattern: `(Access-Control-Allow-Origin\\s*[=:]\\s*["'\\*]\\*|cors\\(\\s*\\{[^}]*origin\\s*:\\s*["'\\*]\\*|allowAllOrigins|allow_all_origins)`,
    languages: ["js", "ts", "py", "java", "go"],
    description: "CORS configured with wildcard origin, allowing any domain to make cross-origin requests.",
    remediation: "Specify explicit allowed origins instead of using wildcard (*).",
  },
  {
    id: "MISC-003",
    title: "Missing Security Headers",
    cwe: "CWE-693",
    owasp: "A05:2021 Security Misconfiguration",
    severity: "medium",
    confidence: "low",
    pattern: `helmet\\(\\s*\\{[^}]*contentSecurityPolicy\\s*:\\s*false`,
    languages: ["js", "ts"],
    description: "Security headers (CSP) explicitly disabled, removing important protection layers.",
    remediation: "Enable Content-Security-Policy and other security headers.",
  },
  {
    id: "MISC-004",
    title: "Verbose Error Messages",
    cwe: "CWE-209",
    owasp: "A05:2021 Security Misconfiguration",
    severity: "low",
    confidence: "medium",
    pattern: `(res|response)\\.(send|json|write)\\(.*\\b(err|error|exception)\\.(message|stack|trace)`,
    languages: ["js", "ts"],
    description: "Detailed error information sent to client, potentially exposing sensitive system details.",
    remediation: "Return generic error messages to clients and log detailed errors server-side.",
  },

  // === BROKEN ACCESS CONTROL (OWASP A01:2021) ===
  {
    id: "ACCESS-001",
    title: "Path Traversal Vulnerability",
    cwe: "CWE-22",
    owasp: "A01:2021 Broken Access Control",
    severity: "high",
    confidence: "medium",
    pattern: `(readFile|readFileSync|open|createReadStream)\\s*\\(.*\\+(req\\.|request\\.|params\\.|query\\.)`,
    languages: ["js", "ts"],
    description: "File path constructed from user input without sanitization, vulnerable to path traversal.",
    remediation: "Use path.resolve() with a base directory and validate the resolved path is within allowed boundaries.",
  },
  {
    id: "ACCESS-002",
    title: "Insecure Direct Object Reference (IDOR)",
    cwe: "CWE-639",
    owasp: "A01:2021 Broken Access Control",
    severity: "medium",
    confidence: "low",
    pattern: `(findById|find_by_id|get_object_or_404)\\s*\\(\\s*(req\\.|request\\.)`,
    languages: ["js", "ts", "py"],
    description: "Object lookup using user-supplied ID without authorization check.",
    remediation: "Verify the authenticated user has permission to access the requested resource.",
  },
  {
    id: "ACCESS-003",
    title: "Missing Authorization Check",
    cwe: "CWE-862",
    owasp: "A01:2021 Broken Access Control",
    severity: "medium",
    confidence: "low",
    pattern: `(router|app)\\.(get|post|put|delete|patch)\\s*\\(\\s*['"][^'"]*admin`,
    languages: ["js", "ts"],
    description: "Admin route potentially missing authorization middleware.",
    remediation: "Ensure all admin routes have proper authentication and authorization middleware.",
  },

  // === INSECURE DESERIALIZATION (OWASP A08:2021) ===
  {
    id: "DESER-001",
    title: "Unsafe Deserialization - pickle",
    cwe: "CWE-502",
    owasp: "A08:2021 Software and Data Integrity Failures",
    severity: "critical",
    confidence: "high",
    pattern: `pickle\\.(loads?|Unpickler)\\s*\\(`,
    languages: ["py"],
    description: "Python pickle deserialization of untrusted data can lead to arbitrary code execution.",
    remediation: "Use JSON or other safe serialization formats. If pickle is required, use hmac verification.",
  },
  {
    id: "DESER-002",
    title: "Unsafe Deserialization - yaml.load",
    cwe: "CWE-502",
    owasp: "A08:2021 Software and Data Integrity Failures",
    severity: "high",
    confidence: "high",
    pattern: `yaml\\.load\\s*\\([^)]*(?!Loader\\s*=\\s*yaml\\.SafeLoader)`,
    languages: ["py"],
    description: "yaml.load() without SafeLoader can execute arbitrary Python code.",
    remediation: "Use yaml.safe_load() or yaml.load(data, Loader=yaml.SafeLoader).",
  },
  {
    id: "DESER-003",
    title: "Unsafe JSON Parsing with reviver",
    cwe: "CWE-502",
    owasp: "A08:2021 Software and Data Integrity Failures",
    severity: "medium",
    confidence: "low",
    pattern: `JSON\\.parse\\s*\\(.*,\\s*function`,
    languages: ["js", "ts"],
    description: "JSON.parse with custom reviver function may introduce security issues.",
    remediation: "Validate and sanitize the output of JSON.parse operations.",
  },

  // === VULNERABLE COMPONENTS (OWASP A06:2021) ===
  {
    id: "VULN-001",
    title: "Known Vulnerable Package Import",
    cwe: "CWE-1395",
    owasp: "A06:2021 Vulnerable and Outdated Components",
    severity: "medium",
    confidence: "low",
    pattern: `require\\s*\\(\\s*["'](lodash|underscore|moment|request|node-uuid)["']\\s*\\)`,
    languages: ["js", "ts"],
    description: "Import of package with known historical vulnerabilities or deprecated status.",
    remediation: "Update to latest patched version or migrate to maintained alternatives.",
  },

  // === LOGGING & MONITORING (OWASP A09:2021) ===
  {
    id: "LOG-001",
    title: "Sensitive Data in Logs",
    cwe: "CWE-532",
    owasp: "A09:2021 Security Logging and Monitoring Failures",
    severity: "medium",
    confidence: "medium",
    pattern: `(console\\.log|logger?\\.(info|debug|warn|error|log))\\s*\\(.*\\b(password|secret|token|apiKey|api_key|credential|ssn|credit.?card)`,
    languages: ["js", "ts", "py", "java"],
    description: "Potentially logging sensitive data (passwords, tokens, secrets) which could be exposed in log files.",
    remediation: "Redact or mask sensitive data before logging. Use structured logging with field-level controls.",
  },

  // === SSRF (OWASP A10:2021) ===
  {
    id: "SSRF-001",
    title: "Server-Side Request Forgery",
    cwe: "CWE-918",
    owasp: "A10:2021 Server-Side Request Forgery",
    severity: "high",
    confidence: "medium",
    pattern: `(fetch|axios|request|http\\.get|urllib|requests\\.get)\\s*\\(\\s*(req\\.|request\\.|params\\.|query\\.|body\\.)`,
    languages: ["js", "ts", "py"],
    description: "HTTP request made with user-controlled URL, potentially allowing SSRF attacks.",
    remediation: "Validate and allowlist destination URLs. Block internal/private IP ranges.",
  },

  // === PROTOTYPE POLLUTION ===
  {
    id: "PROTO-001",
    title: "Prototype Pollution",
    cwe: "CWE-1321",
    owasp: "A03:2021 Injection",
    severity: "high",
    confidence: "medium",
    pattern: `(Object\\.assign|\\.\\.\\.|merge|extend|defaultsDeep)\\s*\\([^,]*,\\s*(req\\.|request\\.|body\\.|params\\.|query\\.)`,
    languages: ["js", "ts"],
    description: "Object merge/assign with user-controlled input may lead to prototype pollution.",
    remediation: "Use Object.create(null) for key-value stores, validate keys against __proto__ and constructor.",
  },

  // === REGEX DoS ===
  {
    id: "REDOS-001",
    title: "Regular Expression Denial of Service (ReDoS)",
    cwe: "CWE-1333",
    owasp: "A05:2021 Security Misconfiguration",
    severity: "medium",
    confidence: "low",
    pattern: `new\\s+RegExp\\s*\\(\\s*(req\\.|request\\.|params\\.|query\\.|body\\.)`,
    languages: ["js", "ts"],
    description: "RegExp constructed from user input, vulnerable to ReDoS attacks.",
    remediation: "Sanitize user input before using in regular expressions, or use RE2 for safe regex.",
  },

  // === HARDCODED SECRETS ===
  {
    id: "SECRET-001",
    title: "Hardcoded Password",
    cwe: "CWE-798",
    owasp: "A07:2021 Identification and Authentication Failures",
    severity: "critical",
    confidence: "medium",
    pattern: `(password|passwd|pwd)\\s*[=:]\\s*["'][^"'\\s]{8,}["']`,
    languages: ["js", "ts", "py", "java", "go", "rb", "php"],
    description: "Hardcoded password found in source code.",
    remediation: "Use environment variables or a secret management service for credentials.",
  },
  {
    id: "SECRET-002",
    title: "Hardcoded API Key",
    cwe: "CWE-798",
    owasp: "A07:2021 Identification and Authentication Failures",
    severity: "high",
    confidence: "medium",
    pattern: `(api[_-]?key|apikey|api[_-]?secret)\\s*[=:]\\s*["'][A-Za-z0-9+/=_-]{20,}["']`,
    languages: ["js", "ts", "py", "java", "go", "rb", "php"],
    description: "Hardcoded API key found in source code.",
    remediation: "Store API keys in environment variables or a secret management service.",
  },

  // === XXE ===
  {
    id: "XXE-001",
    title: "XML External Entity (XXE) Injection",
    cwe: "CWE-611",
    owasp: "A05:2021 Security Misconfiguration",
    severity: "high",
    confidence: "high",
    pattern: `(parseXML|XMLParser|etree\\.parse|SAXParser|DocumentBuilder)\\s*\\(`,
    languages: ["js", "ts", "py", "java"],
    description: "XML parser without disabled external entity processing may be vulnerable to XXE.",
    remediation: "Disable external entity processing in XML parser configuration.",
  },

  // === FILE UPLOAD ===
  {
    id: "UPLOAD-001",
    title: "Unrestricted File Upload",
    cwe: "CWE-434",
    owasp: "A04:2021 Insecure Design",
    severity: "high",
    confidence: "low",
    pattern: `(multer|formidable|busboy|multipart)\\s*\\(`,
    languages: ["js", "ts"],
    description: "File upload handler detected. Ensure proper validation of file types, sizes, and content.",
    remediation: "Validate file extensions, MIME types, and content. Set size limits and store outside webroot.",
  },

  // === OPEN REDIRECT ===
  {
    id: "REDIRECT-001",
    title: "Open Redirect",
    cwe: "CWE-601",
    owasp: "A01:2021 Broken Access Control",
    severity: "medium",
    confidence: "medium",
    pattern: `(redirect|location\\.href|window\\.location)\\s*[=(]\\s*(req\\.|request\\.|params\\.|query\\.)`,
    languages: ["js", "ts"],
    description: "Redirect destination controlled by user input, potentially allowing open redirect attacks.",
    remediation: "Validate redirect URLs against an allowlist of trusted domains.",
  },

  // === SOLIDITY/SMART CONTRACT ===
  {
    id: "SOL-001",
    title: "Reentrancy Vulnerability",
    cwe: "CWE-841",
    owasp: "A04:2021 Insecure Design",
    severity: "critical",
    confidence: "medium",
    pattern: `\\.call\\{value:.*\\}\\s*\\(`,
    languages: ["sol"],
    description: "External call with value transfer before state update, vulnerable to reentrancy.",
    remediation: "Follow checks-effects-interactions pattern. Update state before external calls.",
  },
  {
    id: "SOL-002",
    title: "Unchecked External Call",
    cwe: "CWE-252",
    owasp: "A04:2021 Insecure Design",
    severity: "high",
    confidence: "medium",
    pattern: `\\.call\\(|\\.(send|transfer)\\(`,
    languages: ["sol"],
    description: "External call return value not checked, may silently fail.",
    remediation: "Always check the return value of external calls and handle failures.",
  },

  // === GO SPECIFIC ===
  {
    id: "GO-001",
    title: "SQL Injection in Go",
    cwe: "CWE-89",
    owasp: "A03:2021 Injection",
    severity: "critical",
    confidence: "high",
    pattern: `(db\\.(Query|Exec|QueryRow))\\s*\\(\\s*(fmt\\.Sprintf|"[^"]*"\\s*\\+)`,
    languages: ["go"],
    description: "SQL query built with fmt.Sprintf or string concatenation in Go.",
    remediation: "Use parameterized queries with $1, $2 placeholders.",
  },

  // === RUST SPECIFIC ===
  {
    id: "RUST-001",
    title: "Unsafe Block Usage",
    cwe: "CWE-242",
    owasp: "A04:2021 Insecure Design",
    severity: "medium",
    confidence: "high",
    pattern: `unsafe\\s*\\{`,
    languages: ["rs"],
    description: "Unsafe block detected. Code within unsafe blocks bypasses Rust's safety guarantees.",
    remediation: "Minimize unsafe code. Document safety invariants. Consider safe alternatives.",
  },

  // === C/C++ SPECIFIC ===
  {
    id: "MEMORY-001",
    title: "Buffer Overflow - Unsafe Functions",
    cwe: "CWE-120",
    owasp: "A03:2021 Injection",
    severity: "critical",
    confidence: "high",
    pattern: `\\b(strcpy|strcat|sprintf|gets|scanf)\\s*\\(`,
    languages: ["c", "cpp", "h", "hpp"],
    description: "Using buffer-unsafe C functions that don't check bounds.",
    remediation: "Use safe alternatives: strncpy, strncat, snprintf, fgets, scanf with width specifiers.",
  },
  {
    id: "MEMORY-002",
    title: "Format String Vulnerability",
    cwe: "CWE-134",
    owasp: "A03:2021 Injection",
    severity: "high",
    confidence: "medium",
    pattern: `(printf|fprintf|sprintf|snprintf)\\s*\\([^,]*\\)\\s*;`,
    languages: ["c", "cpp"],
    description: "printf-family function called with user-controlled format string.",
    remediation: "Always use a format string literal: printf(\"%s\", user_input) instead of printf(user_input).",
  },

  // === PHP SPECIFIC ===
  {
    id: "PHP-001",
    title: "PHP Object Injection",
    cwe: "CWE-502",
    owasp: "A08:2021 Software and Data Integrity Failures",
    severity: "critical",
    confidence: "high",
    pattern: `unserialize\\s*\\(`,
    languages: ["php"],
    description: "PHP unserialize() on user-controlled data can lead to arbitrary code execution.",
    remediation: "Use json_decode() instead of unserialize() for data from untrusted sources.",
  },
  {
    id: "PHP-002",
    title: "PHP File Inclusion",
    cwe: "CWE-98",
    owasp: "A03:2021 Injection",
    severity: "critical",
    confidence: "medium",
    pattern: `(include|require|include_once|require_once)\\s*\\(\\s*\\$`,
    languages: ["php"],
    description: "Dynamic file inclusion with variable path, vulnerable to local/remote file inclusion.",
    remediation: "Use an allowlist of permitted files. Never include files based on user input.",
  },
]

type ScanType = "quick" | "standard" | "deep" | "owasp" | "secrets"

function getFileExtension(filePath: string): string {
  return path.extname(filePath).slice(1).toLowerCase()
}

function filterPatternsByScanType(patterns: VulnerabilityPattern[], scanType: ScanType): VulnerabilityPattern[] {
  switch (scanType) {
    case "quick":
      return patterns.filter((p) => p.severity === "critical" || p.severity === "high")
    case "owasp":
      return patterns.filter((p) => p.owasp.startsWith("A"))
    case "secrets":
      return patterns.filter((p) => p.id.startsWith("SECRET-") || p.cwe === "CWE-798")
    case "deep":
    case "standard":
    default:
      return patterns
  }
}

function formatSeverityBadge(severity: string): string {
  const badges: Record<string, string> = {
    critical: "[CRITICAL]",
    high: "[HIGH]",
    medium: "[MEDIUM]",
    low: "[LOW]",
    info: "[INFO]",
  }
  return badges[severity] || "[UNKNOWN]"
}

export const SecurityScanTool = Tool.define("security_scan", async () => {
  return {
    description: DESCRIPTION,
    parameters: z.object({
      target: z
        .string()
        .describe(
          "The file or directory path to scan. Defaults to the project root if not specified.",
        )
        .optional(),
      scanType: z
        .enum(["quick", "standard", "deep", "owasp", "secrets"])
        .default("standard")
        .describe("Type of security scan to perform."),
      include: z
        .string()
        .optional()
        .describe('File pattern to include in scan (e.g., "*.js", "*.{ts,tsx,py}")'),
      severity: z
        .enum(["critical", "high", "medium", "low", "info"])
        .optional()
        .describe("Minimum severity level to report"),
      exclude: z
        .string()
        .optional()
        .describe("Glob pattern for files/directories to exclude from scanning"),
    }),
    async execute(params, ctx) {
      const target = params.target
        ? path.isAbsolute(params.target)
          ? params.target
          : path.resolve(Instance.directory, params.target)
        : Instance.directory

      await ctx.ask({
        permission: "security_scan",
        patterns: [target],
        always: ["*"],
        metadata: { scanType: params.scanType, target },
      })

      log.info("starting security scan", { target, scanType: params.scanType })

      const severityOrder = ["critical", "high", "medium", "low", "info"]
      const minSeverityIdx = params.severity ? severityOrder.indexOf(params.severity) : severityOrder.length - 1

      const patterns = filterPatternsByScanType(VULNERABILITY_PATTERNS, params.scanType)
      const filteredPatterns = patterns.filter((p) => severityOrder.indexOf(p.severity) <= minSeverityIdx)

      const findings: Array<{
        pattern: VulnerabilityPattern
        file: string
        line: number
        code: string
      }> = []

      const rgPath = await Ripgrep.filepath()

      for (const vuln of filteredPatterns) {
        try {
          const args = ["-nH", "--no-messages", "--field-match-separator=|", "--regexp", vuln.pattern]

          if (params.include) {
            args.push("--glob", params.include)
          } else {
            for (const lang of vuln.languages) {
              args.push("--glob", `*.${lang}`)
            }
          }

          if (params.exclude) {
            args.push("--glob", `!${params.exclude}`)
          }

          // Always exclude common non-source directories
          args.push("--glob", "!node_modules")
          args.push("--glob", "!.git")
          args.push("--glob", "!dist")
          args.push("--glob", "!build")
          args.push("--glob", "!vendor")
          args.push("--glob", "!__pycache__")
          args.push("--glob", "!*.min.js")
          args.push("--glob", "!*.min.css")
          args.push("--glob", "!*.map")
          args.push("--glob", "!*.lock")

          args.push(target)

          const proc = Bun.spawn([rgPath, ...args], {
            stdout: "pipe",
            stderr: "pipe",
            signal: ctx.abort,
          })

          const output = await new Response(proc.stdout).text()
          await proc.exited

          if (output.trim()) {
            const lines = output.trim().split(/\r?\n/)
            for (const line of lines) {
              if (!line) continue
              const [filePath, lineNumStr, ...codeparts] = line.split("|")
              if (!filePath || !lineNumStr) continue
              findings.push({
                pattern: vuln,
                file: filePath,
                line: parseInt(lineNumStr, 10),
                code: codeparts.join("|").trim().substring(0, 200),
              })
            }
          }
        } catch {
          // Pattern scan failed, continue with next
        }
      }

      // Sort findings by severity
      findings.sort((a, b) => severityOrder.indexOf(a.pattern.severity) - severityOrder.indexOf(b.pattern.severity))

      // Build output
      const outputLines: string[] = []

      // Header
      outputLines.push("=" .repeat(80))
      outputLines.push("  OPENCODE SECURITY SCAN REPORT - SAST Analysis")
      outputLines.push("=" .repeat(80))
      outputLines.push("")
      outputLines.push(`  Target:     ${target}`)
      outputLines.push(`  Scan Type:  ${params.scanType.toUpperCase()}`)
      outputLines.push(`  Date:       ${new Date().toISOString()}`)
      outputLines.push(`  Patterns:   ${filteredPatterns.length} rules checked`)
      outputLines.push("")

      // Summary
      const bySeverity = {
        critical: findings.filter((f) => f.pattern.severity === "critical").length,
        high: findings.filter((f) => f.pattern.severity === "high").length,
        medium: findings.filter((f) => f.pattern.severity === "medium").length,
        low: findings.filter((f) => f.pattern.severity === "low").length,
        info: findings.filter((f) => f.pattern.severity === "info").length,
      }

      outputLines.push("-".repeat(80))
      outputLines.push("  SUMMARY")
      outputLines.push("-".repeat(80))
      outputLines.push(`  Total Findings: ${findings.length}`)
      outputLines.push(`  Critical: ${bySeverity.critical}  |  High: ${bySeverity.high}  |  Medium: ${bySeverity.medium}  |  Low: ${bySeverity.low}  |  Info: ${bySeverity.info}`)
      outputLines.push("")

      if (findings.length === 0) {
        outputLines.push("  No security vulnerabilities detected. The scanned code appears clean.")
        outputLines.push("")
        outputLines.push("  NOTE: This is a pattern-based analysis. Consider complementing with")
        outputLines.push("  dynamic testing and manual code review for complete coverage.")
      } else {
        // OWASP category breakdown
        const byOwasp = new Map<string, number>()
        for (const f of findings) {
          const count = byOwasp.get(f.pattern.owasp) || 0
          byOwasp.set(f.pattern.owasp, count + 1)
        }

        outputLines.push("-".repeat(80))
        outputLines.push("  OWASP TOP 10 BREAKDOWN")
        outputLines.push("-".repeat(80))
        for (const [category, count] of [...byOwasp.entries()].sort()) {
          outputLines.push(`  ${category}: ${count} finding(s)`)
        }
        outputLines.push("")

        // Detailed findings
        outputLines.push("-".repeat(80))
        outputLines.push("  DETAILED FINDINGS")
        outputLines.push("-".repeat(80))

        for (let i = 0; i < findings.length; i++) {
          const f = findings[i]
          const relPath = path.relative(Instance.directory, f.file)
          outputLines.push("")
          outputLines.push(`  ${formatSeverityBadge(f.pattern.severity)} Finding #${i + 1}: ${f.pattern.title}`)
          outputLines.push(`  ${"~".repeat(70)}`)
          outputLines.push(`  ID:            ${f.pattern.id}`)
          outputLines.push(`  CWE:           ${f.pattern.cwe}`)
          outputLines.push(`  OWASP:         ${f.pattern.owasp}`)
          outputLines.push(`  Severity:      ${f.pattern.severity.toUpperCase()}`)
          outputLines.push(`  Confidence:    ${f.pattern.confidence.toUpperCase()}`)
          outputLines.push(`  File:          ${relPath}:${f.line}`)
          outputLines.push(`  Description:   ${f.pattern.description}`)
          outputLines.push(`  Remediation:   ${f.pattern.remediation}`)
          outputLines.push(`  Code:          ${f.code}`)
        }

        // Remediation priority
        outputLines.push("")
        outputLines.push("-".repeat(80))
        outputLines.push("  REMEDIATION PRIORITY")
        outputLines.push("-".repeat(80))
        outputLines.push("")
        if (bySeverity.critical > 0) {
          outputLines.push(`  1. [IMMEDIATE] Fix ${bySeverity.critical} CRITICAL vulnerabilities - these are exploitable now`)
        }
        if (bySeverity.high > 0) {
          outputLines.push(`  2. [URGENT] Fix ${bySeverity.high} HIGH severity issues - significant security risk`)
        }
        if (bySeverity.medium > 0) {
          outputLines.push(`  3. [PLANNED] Address ${bySeverity.medium} MEDIUM severity issues in next sprint`)
        }
        if (bySeverity.low > 0) {
          outputLines.push(`  4. [BACKLOG] Review ${bySeverity.low} LOW severity findings when convenient`)
        }
      }

      outputLines.push("")
      outputLines.push("=".repeat(80))
      outputLines.push("  End of Security Scan Report")
      outputLines.push("=".repeat(80))

      const output = outputLines.join("\n")

      return {
        title: `Security Scan: ${findings.length} findings (${bySeverity.critical}C/${bySeverity.high}H/${bySeverity.medium}M/${bySeverity.low}L)`,
        metadata: {
          total: findings.length,
          critical: bySeverity.critical,
          high: bySeverity.high,
          medium: bySeverity.medium,
          low: bySeverity.low,
          scanType: params.scanType,
        },
        output,
      }
    },
  }
})
