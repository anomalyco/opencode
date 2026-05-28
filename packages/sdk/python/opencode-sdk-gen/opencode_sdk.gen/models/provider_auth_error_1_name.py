from enum import Enum


class ProviderAuthError1Name(str, Enum):
    BADREQUEST = "BadRequest"
    PROVIDERAUTHOAUTHCALLBACKFAILED = "ProviderAuthOauthCallbackFailed"
    PROVIDERAUTHOAUTHCODEMISSING = "ProviderAuthOauthCodeMissing"
    PROVIDERAUTHOAUTHMISSING = "ProviderAuthOauthMissing"
    PROVIDERAUTHVALIDATIONFAILED = "ProviderAuthValidationFailed"

    def __str__(self) -> str:
        return str(self.value)
