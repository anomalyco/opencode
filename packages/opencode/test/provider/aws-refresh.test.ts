import { test, expect, describe } from "bun:test"
import {
  isAWSCredentialError,
  classifyAWSError,
  AWSErrorType,
  validateCommand,
  parseCommand,
} from "../../src/provider/aws-refresh"

describe("classifyAWSError", () => {
  describe("expired token errors", () => {
    test("detects 'Token is expired'", () => {
      const result = classifyAWSError(new Error("Token is expired and cannot be used"))
      expect(result.type).toBe(AWSErrorType.EXPIRED_TOKEN)
      expect(result.refreshable).toBe(true)
    })

    test("detects 'ExpiredToken' code", () => {
      const result = classifyAWSError(new Error("ExpiredToken: The token has expired"))
      expect(result.type).toBe(AWSErrorType.EXPIRED_TOKEN)
      expect(result.refreshable).toBe(true)
    })

    test("detects SSO session expired", () => {
      const result = classifyAWSError(
        new Error(
          "The SSO session associated with this profile has expired. To refresh this SSO session run aws sso login",
        ),
      )
      expect(result.type).toBe(AWSErrorType.EXPIRED_TOKEN)
      expect(result.refreshable).toBe(true)
    })

    test("detects 'security token included in the request is expired'", () => {
      const result = classifyAWSError(new Error("The security token included in the request is expired"))
      expect(result.type).toBe(AWSErrorType.EXPIRED_TOKEN)
      expect(result.refreshable).toBe(true)
    })

    test("detects 'expired security credentials'", () => {
      const result = classifyAWSError(new Error("User has expired security credentials"))
      expect(result.type).toBe(AWSErrorType.EXPIRED_TOKEN)
      expect(result.refreshable).toBe(true)
    })

    test("detects SSO token not found or invalid", () => {
      const result = classifyAWSError(
        new Error("SSO session token associated with this profile was not found or is invalid in the cache"),
      )
      expect(result.type).toBe(AWSErrorType.EXPIRED_TOKEN)
      expect(result.refreshable).toBe(true)
    })
  })

  describe("web identity errors", () => {
    test("detects web identity token expired", () => {
      const result = classifyAWSError(new Error("The web identity token that was passed is expired or is not valid"))
      expect(result.type).toBe(AWSErrorType.WEB_IDENTITY)
      expect(result.refreshable).toBe(true)
    })

    test("detects IDPCommunicationError", () => {
      const result = classifyAWSError(new Error("IDPCommunicationError: Could not reach identity provider"))
      expect(result.type).toBe(AWSErrorType.WEB_IDENTITY)
      expect(result.refreshable).toBe(true)
    })

    test("detects IDPRejectedClaim", () => {
      const result = classifyAWSError(new Error("IDPRejectedClaim: Authentication failed"))
      expect(result.type).toBe(AWSErrorType.WEB_IDENTITY)
      expect(result.refreshable).toBe(true)
    })

    test("detects InvalidIdentityToken", () => {
      const result = classifyAWSError(new Error("InvalidIdentityToken: Token could not be validated"))
      expect(result.type).toBe(AWSErrorType.WEB_IDENTITY)
      expect(result.refreshable).toBe(true)
    })
  })

  describe("missing credentials errors", () => {
    test("detects 'Unable to resolve AWS access key id'", () => {
      const result = classifyAWSError(new Error("Unable to resolve AWS access key id"))
      expect(result.type).toBe(AWSErrorType.MISSING_CREDENTIALS)
      expect(result.refreshable).toBe(false)
    })

    test("detects 'Could not load credentials from any providers'", () => {
      const result = classifyAWSError(new Error("Could not load credentials from any providers"))
      expect(result.type).toBe(AWSErrorType.MISSING_CREDENTIALS)
      expect(result.refreshable).toBe(false)
    })

    test("detects 'No viable credential source'", () => {
      const result = classifyAWSError(new Error("No viable credential source found"))
      expect(result.type).toBe(AWSErrorType.MISSING_CREDENTIALS)
      expect(result.refreshable).toBe(false)
    })
  })

  describe("profile not found errors", () => {
    test("detects 'could not be found'", () => {
      const result = classifyAWSError(new Error("Profile myprofile could not be found"))
      expect(result.type).toBe(AWSErrorType.PROFILE_NOT_FOUND)
      expect(result.refreshable).toBe(false)
    })

    test("detects 'Cannot find profile'", () => {
      const result = classifyAWSError(new Error("Cannot find profile myprofile in ~/.aws/credentials"))
      expect(result.type).toBe(AWSErrorType.PROFILE_NOT_FOUND)
      expect(result.refreshable).toBe(false)
    })
  })

  describe("invalid credentials errors", () => {
    test("detects InvalidClientTokenId", () => {
      const result = classifyAWSError(new Error("InvalidClientTokenId: The AWS access key ID does not exist"))
      expect(result.type).toBe(AWSErrorType.INVALID_CREDENTIALS)
      expect(result.refreshable).toBe(false)
    })

    test("detects SignatureDoesNotMatch", () => {
      const result = classifyAWSError(new Error("SignatureDoesNotMatch: Signature calculation failed"))
      expect(result.type).toBe(AWSErrorType.INVALID_CREDENTIALS)
      expect(result.refreshable).toBe(false)
    })
  })

  describe("access denied errors", () => {
    test("detects 'is not authorized to perform'", () => {
      const result = classifyAWSError(
        new Error("User arn:aws:iam::123:user/test is not authorized to perform: sts:AssumeRole"),
      )
      expect(result.type).toBe(AWSErrorType.ACCESS_DENIED)
      expect(result.refreshable).toBe(false)
    })

    test("detects 'AccessDenied'", () => {
      const result = classifyAWSError(new Error("AccessDenied: User does not have permission"))
      expect(result.type).toBe(AWSErrorType.ACCESS_DENIED)
      expect(result.refreshable).toBe(false)
    })
  })

  describe("unknown errors", () => {
    test("returns unknown for unrecognized errors", () => {
      const result = classifyAWSError(new Error("Something else went wrong"))
      expect(result.type).toBe(AWSErrorType.UNKNOWN)
      expect(result.refreshable).toBe(false)
    })

    test("handles null input", () => {
      const result = classifyAWSError(null)
      expect(result.type).toBe(AWSErrorType.UNKNOWN)
      expect(result.refreshable).toBe(false)
    })

    test("handles undefined input", () => {
      const result = classifyAWSError(undefined)
      expect(result.type).toBe(AWSErrorType.UNKNOWN)
      expect(result.refreshable).toBe(false)
    })

    test("handles string input", () => {
      const result = classifyAWSError("Some error string")
      expect(result.type).toBe(AWSErrorType.UNKNOWN)
      expect(result.refreshable).toBe(false)
    })
  })
})

describe("isAWSCredentialError", () => {
  test("returns true for expired token errors", () => {
    expect(isAWSCredentialError(new Error("Token is expired"))).toBe(true)
    expect(isAWSCredentialError(new Error("ExpiredToken"))).toBe(true)
    expect(isAWSCredentialError(new Error("The security token included in the request is expired"))).toBe(true)
  })

  test("returns true for web identity errors", () => {
    expect(isAWSCredentialError(new Error("The web identity token that was passed is expired"))).toBe(true)
    expect(isAWSCredentialError(new Error("IDPCommunicationError"))).toBe(true)
  })

  test("returns false for missing credentials errors", () => {
    expect(isAWSCredentialError(new Error("Could not load credentials from any providers"))).toBe(false)
    expect(isAWSCredentialError(new Error("No viable credential source"))).toBe(false)
  })

  test("returns false for invalid credentials errors", () => {
    expect(isAWSCredentialError(new Error("InvalidClientTokenId"))).toBe(false)
    expect(isAWSCredentialError(new Error("SignatureDoesNotMatch"))).toBe(false)
  })

  test("returns false for profile not found errors", () => {
    expect(isAWSCredentialError(new Error("Profile test could not be found"))).toBe(false)
  })

  test("returns false for access denied errors", () => {
    expect(isAWSCredentialError(new Error("AccessDenied"))).toBe(false)
  })

  test("returns false for unknown errors", () => {
    expect(isAWSCredentialError(new Error("Random error"))).toBe(false)
    expect(isAWSCredentialError(null)).toBe(false)
    expect(isAWSCredentialError(undefined)).toBe(false)
  })
})

describe("validateCommand", () => {
  test("accepts commands starting with 'aws'", () => {
    const result = validateCommand("aws sso login --profile myprofile")
    expect(result.valid).toBe(true)
  })

  test("accepts absolute paths", () => {
    const result = validateCommand("/usr/local/bin/custom-refresh")
    expect(result.valid).toBe(true)
  })

  test("rejects relative paths without 'aws'", () => {
    const result = validateCommand("./refresh-script.sh")
    expect(result.valid).toBe(false)
    expect(result.error).toBeDefined()
  })

  test("rejects commands without 'aws' prefix", () => {
    const result = validateCommand("refresh-aws")
    expect(result.valid).toBe(false)
    expect(result.error).toBe("Command must start with 'aws' or be an absolute path")
  })

  test("rejects empty commands", () => {
    const result = validateCommand("")
    expect(result.valid).toBe(false)
    expect(result.error).toBe("Command cannot be empty")
  })

  test("rejects whitespace-only commands", () => {
    const result = validateCommand("   ")
    expect(result.valid).toBe(false)
    expect(result.error).toBe("Command cannot be empty")
  })

  test("handles commands with extra whitespace", () => {
    const result = validateCommand("   aws sso login   ")
    expect(result.valid).toBe(true)
  })
})

describe("parseCommand", () => {
  test("parses simple command", () => {
    const result = parseCommand("aws sso login")
    expect(result).toEqual(["aws", "sso", "login"])
  })

  test("parses command with profile flag", () => {
    const result = parseCommand("aws sso login --profile myprofile")
    expect(result).toEqual(["aws", "sso", "login", "--profile", "myprofile"])
  })

  test("handles double-quoted arguments", () => {
    const result = parseCommand('aws sso login --profile "my profile"')
    expect(result).toEqual(["aws", "sso", "login", "--profile", "my profile"])
  })

  test("handles single-quoted arguments", () => {
    const result = parseCommand("aws sso login --profile 'my profile'")
    expect(result).toEqual(["aws", "sso", "login", "--profile", "my profile"])
  })

  test("handles extra whitespace", () => {
    const result = parseCommand("  aws   sso    login  ")
    expect(result).toEqual(["aws", "sso", "login"])
  })

  test("handles empty string", () => {
    const result = parseCommand("")
    expect(result).toEqual([])
  })

  test("handles multiple flags", () => {
    const result = parseCommand("aws sso login --profile myprofile --region us-east-1")
    expect(result).toEqual(["aws", "sso", "login", "--profile", "myprofile", "--region", "us-east-1"])
  })

  test("handles absolute path", () => {
    const result = parseCommand("/usr/local/bin/script.sh --arg value")
    expect(result).toEqual(["/usr/local/bin/script.sh", "--arg", "value"])
  })
})
