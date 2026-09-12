# totp-signin — E2E results

_Pending re-validation after the SSO-3049 fix deploys._ With SSO-3049 fixed (the hub-federated
session now authorizes the self-service account portal — the user is resolved by the authenticated
principal's `users.id` PK, not a request-env lookup), the enrol→challenge journey is re-enabled
(no longer `test.describe.fixme`). This file is regenerated from the live run by the reporter when
the `totp-signin` project executes.
