---
## Opencode w/ Private Sessions API

This is a fork of [anamolyco's](https://github.com/anomalyco) [Opencode](https://github.com/anomalyco/opencode) coding agent. That is the main development repo, and it sees constant improvements to I recommend just building the code from there.

### Development Notes - How is this different than Opencode?

This fork was made to isolate the agent tool from the opencode.ai session share server, and point it towards a server of my own. 

Another goal is to run the bun session remotely within cloudflare containers,
and potentially breaking down the server side session management from the single server running in containers,  on to cloudflares platform primitives. 



For more info on how to configure opencode [**head over to our docs**](https://opencode.ai/docs).


---
