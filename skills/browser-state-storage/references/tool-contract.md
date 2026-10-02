# Session state safeguards

Cookies are identified by name, domain, path, and partition key where present.
Local and session storage are origin/page scoped. Authenticate material stays
within the current session and page-group authorization.

Never copy Cookie values, tokens, or full storage into a report, debug log, or
replay record. A v2-to-v3 upgrade starts with a separate profile and empty
state unless the user independently signs in again.
