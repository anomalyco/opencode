# location

## GET /api/location

Resolve the requested location or the server default location.

Returns: `Location.PublicInfo`

## POST /api/location/reload

Shut down and rebuild every loaded location. Pending permissions and forms are cancelled; running sessions continue with fresh services at the next step boundary. Emits location.shutdown for client recovery and responds once all replacement builds settle.

Returns: nothing

## Types

- `Location.PublicInfo`: `{ directory: string; project: { id, directory, canonical } }`
