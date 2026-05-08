-- luacheck: no max line length
require('arghelper')

--------------------------------------------------------------------------------
-- Argument parsers.

local placeholder = clink.argmatcher():addarg()

local file = clink.argmatcher():addarg(clink.filematches)
local c_name = clink.argmatcher():addarg({fromhistory=true})
local i_name = clink.argmatcher():addarg({fromhistory=true})
local n_name = clink.argmatcher():addarg({fromhistory=true})
local passwd = placeholder
local r_name = clink.argmatcher():addarg({fromhistory=true})
local s_name = clink.argmatcher():addarg({fromhistory=true})
local hash = clink.argmatcher():addarg({fromhistory=true})
local usage = clink.argmatcher():addarg({fromhistory=true, "Code Signing"})
local csp_name = clink.argmatcher():addarg({fromhistory=true})
local kc_name = clink.argmatcher():addarg({fromhistory=true})
local desc = placeholder
local url = placeholder
local hash_alg = clink.argmatcher():addarg("SHA1", "SHA256")
local oidvalue = placeholder
local dir = clink.argmatcher():addarg(clink.dirmatches)
local oid = placeholder
local pkcs7_mode = clink.argmatcher():_addexarg({
    {"Embedded", "Embeds the signed content in the PKCS7 (the default)"},
    {"DetachedSignedData", "Produces the signed data part of a detached PKCS7"},
    {"Pkcs7DetachedSignedData", "Produces a full detached PKCS7"},
})
local index = placeholder
local cat_guid = clink.argmatcher():addarg({fromhistory=true})

local common_flags = {
    {"/q",                          "No output on success and minimal output on failure"},
    {"/v",                          "Print verbose success and status messages"},
}

local timestamp_flags = {
    {"/t"..url, " url",             "Specify the timestamp server's URL"},
    {"/tr"..url, " url",            "Specifies the RFC 3161 timestamp server's URL"},
    {"/tseal"..url, " url",         "Specifies the RFC 3161 timestamp server's URL for timestamping a sealed file"},
    {"/td"..hash_alg, " alg",       "Used with /tr or /tseal to request a digest algorithm used by the RFC 3161 timestamp server"},
}

--------------------------------------------------------------------------------
-- Command parsers.

local sign_parser = clink.argmatcher()
:_addexflags({
    -- Certificate selection options:
    {"/a",                          "Select the best signing cert automatically"},
    {"/ac"..file, " file",          "Add an additional cert, from <file>, to the signature block"},
    {"/c"..c_name, " name",         "Specify the Certificate Template Name (Microsoft extension) of the signing cert"},
    {"/f"..file, " file",           "Specify the signing cert in a file"},
    {"/i"..i_name, " name",         "Specify the Issuer of the signing cert, or a substring"},
    {"/n"..n_name, " name",         "Specify the Subject Name of the signing cert, or a substring"},
    {"/p"..passwd, " passwd",       "Specify a password to use when opening the PFX file"},
    {"/r"..r_name, " name",         "Specify the Subject Name of a Root cert that the signing cert must chain to"},
    {"/s"..s_name, " name",         "Specify the Store to open when searching for the cert (default is \"MY\")"},
    {"/sm",                         "Open a Machine store instead of a User store"},
    {"/sha1"..hash, " hash",        "Specify the SHA1 thumbprint of the signing cert"},
    {"/fd"..hash_alg, " alg",       "Specifies the file digest algorithm to use for creating file signatures"},
    {"/u"..usage, " usage",         "Specify the Enhanced Key Usage that must be present in the cert"},
    {"/uw",                         "Specify usage of \"Windows System Component Verification\""},
    {"/fdchw",                      "Generate a warning if the file digest and hash algorithms are different in the signing cert"},
    -- Private Key selection options:
    {"/csp"..csp_name, " name",     "Specify the CSP containing the Private Key Container"},
    {"/kc"..kc_name, " name",       "Specify the Key Container Name of the Private Key"},
    -- Signing parameter options:
    {"/as",                         "Append this signature"},
    {"/d"..desc, " desc",           "Provide a description of the signed content"},
    {"/du"..url, " url",            "Provide a URL with more information about the signed content"},
    --timestamp_flags,
    {"/sa"..oidvalue, " oid value", "Specify an <OID> and <value> to be included as an authenticated attribute in the signature"},
    {"/seal",                       "Add a sealing signature if the file format supports it"},
    {"/itos",                       "Create a primary signature with the intent-to-seal attribute"},
    {"/force",                      "Continue to seal or sign in situations where the existing signature or sealing signature needs to the removed to support sealing"},
    {"/nosealwarn",                 "Sealing-related warnings do not affect SignTool's return code"},
    {"/tdchw",                      "Generate a warning if the timestamp server digest and signature hash algorithms are different"},
    -- Digest options:
    {"/dg"..dir, " dir",            "In <dir>, generates the to be signed digest and the unsigned PKCS7 files"},
    {"/ds",                         "Signs the digest only"},
    {"/di"..dir, " dir",            "In <dir>, creates the signature by ingesting the signed digest to the unsigned PKCS7 file"},
    {"/dxml",                       "When used with /dg, produces an XML file"},
    {"/dlib"..file, " dll",         "Specifies the DLL implementing the AuthenticodeDigestSign[Ex] function to sign the digest with"},
    {"/dmdf"..file, " file",        "When used with /dlib, passes the file's contents to the AuthenticodeDigestSign[Ex] function without modification"},
    -- PKCS7 options:
    {"/p7"..dir, " dir",            "In <dir>, produce a PKCS7 file for each specified content file"},
    {"/p7co"..oid, " oid",          "Specifies the <OID> that identifies the signed content"},
    {"/p7ce"..pkcs7_mode, " mode",  "PKCS7 execution mode"},
    -- Other options:
    {"/ph",                         "Generates page hashes for executable files if supported"},
    {"/nph",                        "Suppress page hashes for executable files if supported"},
    {"/rmc",                        "Specifies signing a PE file with the relaxed marker check semantic"},
    --common_flags,
    {"/?",                          "Show help for the sign command"},
})
:_addexflags(timestamp_flags)
:_addexflags(common_flags)
:addarg(clink.filematches)
:loop()

local timestamp_parser = clink.argmatcher()
:_addexflags({
    --timestamp_flags,
    {"/tp"..index, " index",        "Timestamps the signature at <index>"},
    {"/p7",                         "Timestamps PKCS7 files"},
    {"/force",                      "Remove any sealing signature that is present in order to timestamp"},
    {"/nosealwarn",                 "Warnings for removing a sealing signature do not affect SignTool's return code"},
    --common_flags,
    {"/debug",                      "Display additional debug information"},
    {"/?",                          "Show help for the timestamp command"},
})
:_addexflags(timestamp_flags)
:_addexflags(common_flags)

local verify_parser = clink.argmatcher()
:_addexflags({
    -- Catalog options:
    {"/a",                          "Automatically attempt to verify the file using all methods"},
    {"/ad",                         "Find the catalog automatically using the default catalog database"},
    {"/as",                         "Find the catalog automatically using the system component (driver) catalog database"},
    {"/ag"..cat_guid, " guid",      "Find the catalog automatically in the specified catalog database"},
    {"/c"..file, " file",           "Specify the catalog file"},
    {"/o"..placeholder, " ver",     "When verifying a file that is in a signed catalog, verify that the file is valid for the specified platform"},
    {"/hash"..hash_alg, " alg",     "Optional hash algorithm to use when searching for a file in a catalog"},
    -- Verification Policy options:
    {"/pa",                         "Use the \"Default Authenticode\" Verification Policy"},
    {"/pg"..placeholder, " guid",   "Specify the verification policy by GUID (also called ActionID)"},
    -- Signature requirement options:
    {"/ca"..placeholder, " hash",   "Verify that the file is signed with an intermediate CA cert with the specified hash"},
    {"/r"..r_name, " name",         "Specify the Subject Name of a Root cert that the signing cert must chain to"},
    {"/sha1"..placeholder, " hash", "Verify that the signer certificate has the specified hash"},
    {"/tw",                         "Generate a warning if the signature is not timestamped"},
    {"/u"..placeholder, " usage",   "Generate a warning if the specified Enhanced Key Usage is not present in the cert"},
    -- Other options:
    {"/all",                        "Verify all signatures in a file with multiple signatures"},
    {"/ds"..index, " index",        "Verify the signature at <index>"},
    {"/ms",                         "Use multiple verification semantics"},
    {"/sl",                         "Verify sealing signatures for supported file types"},
    {"/p7",                         "Verify PKCS7 files"},
    {"/bp",                         "Perform the verification with the Biometric mode signing policy"},
    {"/enclave",                    "Perform the verification with the enclave signing policy"},
    {"/kp",                         "Perform the verification with the kernel-mode driver signing policy"},
    {"/ph",                         "Print and verify page hash values"},
    {"/d",                          "Print Description and Description URL"},
    --common_flags,
    {"/debug",                      "Display additional debug information"},
    {"/?",                          "Show help for the verify command"},
    {"/p7content"..file, " file",   "Provide p7 content file in case of detached signatures (signed using Pkcs7DetachedSignedData)"},
})
:_addexflags(common_flags)

local catdb_parser = clink.argmatcher()
:_addexflags({
    {"/d",                          "Operate on the default catalog database instead of the system component (driver) catalog database"},
    {"/g"..cat_guid, " guid",       "Operate on the specified catalog database"},
    {"/r",                          "Remove the specified catalogs from the catalog database"},
    {"/u",                          "Automatically generate a unique name for the added catalogs"},
    --common_flags,
    {"/debug",                      "Display additional debug information"},
    {"/?",                          "Show help for the catdb command"},
})
:_addexflags(common_flags)

local remove_parser = clink.argmatcher()
:_addexflags({
    {"/c",                          "Remove all certificates, except for the signer certificate from the signature"},
    {"/s",                          "Remove the signature(s) entirely"},
    {"/u",                          "Remove the unauthenticated attributes from the signature (e.g. dual signatures and timestamps)"},
    --common_flags,
    {"/?",                          "Show help for the remove command"},
})
:_addexflags(common_flags)

--------------------------------------------------------------------------------
-- The SignTool parser.

clink.argmatcher("signtool")
:_addexflags({
    {"/?",                          "Show help"},
})
:_addexarg({
    {"sign"..sign_parser,           "Sign files using an embedded signature"},
    {"timestamp"..timestamp_parser, "Timestamp previous-signed files"},
    {"verify"..verify_parser,       "Verify embedded or catalog signatures"},
    {"catdb"..catdb_parser,         "Modify a catalog database"},
    {"remove"..remove_parser,       "Remove embedded signature(s) or reduce the size of an embedded signed file"},
})

