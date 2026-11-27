# Widget store policy

What widgets must meet for the iOS, Android and (if it ships there) Mac App Store apps: what already complies, and a
to-do list of cross-host features to spec later. Every rule is quoted from its source, checked 2026-11-23.

Sources:

- **Apple:** [App Review Guidelines](https://developer.apple.com/app-store/review/guidelines/) ("Last Updated: October
  16, 2026").
- **Google Play:** [Device and Network Abuse](https://support.google.com/googleplay/android-developer/answer/16273414)
  (the page names [answer 16559646](https://support.google.com/googleplay/android-developer/answer/16559646) as
  canonical), [Use of the REQUEST_INSTALL_PACKAGES
  permission](https://support.google.com/googleplay/android-developer/answer/12085295), [User Generated
  Content](https://support.google.com/googleplay/android-developer/answer/9876937) and [AI-Generated
  Content](https://support.google.com/googleplay/android-developer/answer/13985936). These pages show no date; the
  [Developer Program Policy](https://support.google.com/googleplay/android-developer/answer/17190352) that holds them
  says "(effective October 29, 2026, unless otherwise stated)".
- **Android developer verification:** [Android developer
  verification](https://developer.android.com/developer-verification/guides) ("Last updated 2026-08-18 UTC").

## What already complies

**A confined interpreter, no JIT, no downloaded native code.** Widgets are PsychoScript programs that every client runs
in its own interpreter; "Mobile apps run no JavaScript: they run programs with the Rust PsychoScript through
`psychoscript-mobile` and render natively" (`widgets.md`, Pieces). PsychoScript compiles programs to bytecode for its
VM, "with no ambient access", and has "No `eval`, `Function` constructor or `with`" (`anomalyco/psychoscript` README).
Nothing is compiled to native code.

> [Apple 4.7](https://developer.apple.com/app-store/review/guidelines/#4.7): "Apps may offer certain software that is
> not embedded in the binary, specifically HTML5 and JavaScript mini apps and mini games, streaming games, chatbots, and
> plug-ins." (checked 2026-11-23)
>
> [Google Play, Device and Network Abuse](https://support.google.com/googleplay/android-developer/answer/16273414): "an
> app may not download executable code (such as dex, JAR, .so files) from a source other than Google Play. This
> restriction does not apply to code that runs in a virtual machine or an interpreter where either provides indirect
> access to Android APIs (such as JavaScript in a webview or browser)." (checked 2026-11-23)

**No native API passthrough.** A step "uses no host functions besides `__input`, and live mode adds the generic `__host`
functions" (`widgets.md`); a step has "No other globals" (`widgets.md`, Prelude and step ABI). Host functions are the
fixed list in `widgets-live.md` (Host functions); none reaches a platform API by name.

> [Apple 4.7.2](https://developer.apple.com/app-store/review/guidelines/#4.7.2): "Your app may not extend or expose
> native platform APIs or technologies to the software without prior permission from Apple." (checked 2026-11-23; see
> (e) for the permission question)

**A fixed capability list.** What a widget can do is exactly: native UI from the node schema (`widgets.md`, Nodes), 2D
canvases from checked draw commands (`widgets.md`, Canvas), a WebGPU subset whose batches every host checks ("Nothing
else from WebGPU exists", `widgets-gpu.md`), and HTTPS `fetch` to the hosts the widget template declares
(`widgets-live.md`, Capabilities), and with `storage` the widget template's own data on the user's server
(`widgets-live.md`, Storage). Nothing else crosses.

**Local network blocked outside dev mode.** "By default `fetch` refuses `http:` and any destination that resolves to a
loopback, private or link-local address"; `allowLocalNetwork` comes only from the app's dev mode, "never from
environment variables", and hosts check the address they connect to, against DNS rebinding (`widgets-live.md`,
Capabilities).

> [Google Play, Device and Network Abuse](https://support.google.com/googleplay/android-developer/answer/16273414): "We
> don’t allow apps that interfere with, disrupt, damage, or access in an unauthorized manner the user’s device, other
> devices or computers, servers, networks, application programming interfaces (APIs), or services, including but not
> limited to other apps on the device, any Google service, or an authorized carrier’s network." (checked 2026-11-23)

## To do

### (a) Consent for each widget's network hosts

> [Apple 4.7.3](https://developer.apple.com/app-store/review/guidelines/#4.7.3): "Your app may not share data or privacy
> permissions to any individual software offered in your app without explicit user consent in each instance." (checked
> 2026-11-23)

- **Missing:** "For now clients grant every declared capability automatically" (`widgets-live.md`, Capabilities).
- **Feature:** a consent prompt before a widget's first `fetch`, naming the widget template and its declared hosts. The
  answer is kept per widget template name and host list (a new version with new hosts asks again), can be revoked in
  settings, and shows on the existing capability chip. Denied or unanswered, `fetch` rejects with `CapabilityDenied`.
  Each client already keeps the grant decision in one place.
- **Hosts:** Rune, iOS, Android, web host (the TUI doesn't run live widgets).

### (b) Report and block for widgets from others

> [Apple 1.2](https://developer.apple.com/app-store/review/guidelines/#1.2): "Apps that enable users to create,
> generate, upload, share, or otherwise contribute content [...] To prevent abuse, such apps must include:
>
> - A method for filtering objectionable material from being posted to the app
> - A mechanism to report offensive content and timely responses to concerns
> - The ability to block abusive users from the service
> - Published contact information so users can easily reach you" (checked 2026-11-23)
>
> [Apple 4.7.1](https://developer.apple.com/app-store/review/guidelines/#4.7.1): "Software offered in apps under this
> rule must: [...] include a method for filtering objectionable material, a mechanism to report content and timely
> responses to concerns, and the ability to block abusive users" (checked 2026-11-23)
>
> [Apple 1.2.1](https://developer.apple.com/app-store/review/guidelines/#1.2.1): "These experiences are not native
> “apps” coded by developers—they are content within the app itself and are treated as user-generated content by App
> Review." (checked 2026-11-23)
>
> [Google Play, Device and Network Abuse](https://support.google.com/googleplay/android-developer/answer/16273414):
> "Apps or third-party code, like SDKs, with interpreted languages (JavaScript, Python, Lua, etc.) loaded at run time
> (for example, not packaged with the app) must not allow potential violations of Google Play policies." (checked
> 2026-11-23)
>
> [Google Play, User Generated Content](https://support.google.com/googleplay/android-developer/answer/9876937): "Apps
> that contain or feature UGC, including apps which are specialized browsers or clients to direct users to a UGC
> platform, must implement robust, effective, and ongoing UGC moderation that:
>
> - Requires users accept the app's terms of use and/or user policy before users can create or upload UGC;
> - Defines objectionable content and behaviors (in a way that complies with Google Play Developer Program Policies),
>   and prohibits them in the app’s terms of use or user policies;
> - Conducts UGC moderation, as is reasonable and consistent with the type of UGC hosted by the app. This includes
>   providing an in-app system for reporting and blocking objectionable UGC and users, and taking action against UGC or
>   users where appropriate. [...]" (checked 2026-11-23)
>
> [Google Play, AI-Generated Content](https://support.google.com/googleplay/android-developer/answer/13985936): "Apps
> that generate content using AI must contain in-app user reporting or flagging features that allow users to report or
> flag offensive content to developers without needing to exit the app. Developers should utilize user reports to inform
> content filtering and moderation in their apps." (checked 2026-11-23)

- **Missing:** a widget someone else shared (Console artifacts) can't be reported, its sharer can't be blocked, and
  nothing screens it when it is shared; sharing doesn't ask the sharer to accept terms of use that define objectionable
  content. A widget the agent made in the user's own session is AI-generated content, and it can't be reported or
  flagged in the app either.
- **Feature:** a Report action on every widget, the user's own agent-made ones included (those go to us as AI-generated
  content flags); on any widget not made in the user's own sessions, the Report action (reason, the widget template
  `name@version`, the sharer) to a moderated queue with a response, and Block, which hides that sharer's widgets for the
  user. Shared widget templates are screened when shared, and a takedown makes the server stop serving them. Contact
  information in the app, and terms of use accepted before the first share.
- **Hosts:** server (Console), Rune, iOS, Android, web host.

### (c) A widget index with universal links

> [Apple 4.7.4](https://developer.apple.com/app-store/review/guidelines/#4.7.4): "You must provide an index of software
> and metadata available in your app. It must include universal links that lead to all of the software offered in your
> app." (checked 2026-11-23)

- **Missing:** widgets exist only inside sessions and artifacts; there is no index and no link per widget.
- **Feature:** an index of the widget templates and shared widgets a user can open, with name, description, author, age
  rating and capabilities, each with an `https` link that opens it in the app (universal links on iOS, app links on
  Android) or in the web host.
- **Hosts:** server, iOS, Android, web host (Rune optional).

### (d) An age gate

> [Apple 4.7.5](https://developer.apple.com/app-store/review/guidelines/#4.7.5): "Your app must provide a way for users
> to identify software that exceeds the app’s age rating, and use an age restriction mechanism based on verified or
> declared age to limit access by underage users." (checked 2026-11-23)
>
> [Apple 1.2.1(a)](https://developer.apple.com/app-store/review/guidelines/#1.2.1): "Creator apps must provide a way for
> users to identify content that exceeds the app’s age rating, and use an age restriction mechanism based on verified or
> declared age to limit access by underage users." (checked 2026-11-23)

- **Missing:** widgets have no age rating, and nothing restricts them by age.
- **Feature:** an age rating on each shared widget template (the sharer declares it, moderation can raise it, the index
  shows it); a widget rated above the app's rating is marked, and opens only for a user whose declared or verified age
  allows it.
- **Hosts:** server, iOS, Android, web host.

### (e) The Apple capability statement and the 4.7.2 permission

> [Apple 4.7.2](https://developer.apple.com/app-store/review/guidelines/#4.7.2): "Your app may not extend or expose
> native platform APIs or technologies to the software without prior permission from Apple." (checked 2026-11-23)
>
> [Apple 2.5.2](https://developer.apple.com/app-store/review/guidelines/#2.5.2): "Apps should be self-contained in their
> bundles, and may not read or write data outside the designated container area, nor may they download, install, or
> execute code which introduces or changes features or functionality of the app, including other apps." (checked
> 2026-11-23)

- **Missing:** a written statement for App Review of what widget software can reach, and Apple's answer on 4.7.2.
- **Feature:** a one-page statement from "What already complies" (the interpreter, the host function list, the
  capability list, the local-network block) for the review notes, and a 4.7.2 permission request covering native UI from
  the node schema, the WebGPU subset replayed on Metal, and declared-host HTTPS. Open: whether a confined JavaScript
  interpreter that isn't WebKit, rendering native UI, counts as "HTML5 and JavaScript mini apps" (4.7). Not this rule,
  noted only: [Apple 2.5.6](https://developer.apple.com/app-store/review/guidelines/#2.5.6), "Apps that browse the web
  must use the appropriate WebKit framework and WebKit JavaScript." (checked 2026-11-23); widgets don't browse the web.
- **Hosts:** iOS; Rune if it ships on the Mac App Store.

### (f) Never add

> [Apple 2.5.2](https://developer.apple.com/app-store/review/guidelines/#2.5.2) (above): may not "download, install, or
> execute code which introduces or changes features or functionality of the app, including other apps." (checked
> 2026-11-23)
>
> [Google Play, Use of the REQUEST_INSTALL_PACKAGES
> permission](https://support.google.com/googleplay/android-developer/answer/12085295): "To use this permission, your
> app’s core functionality must include:
>
> - Sending or receiving app packages, AND
> - Enabling user-initiated installation of app packages." (checked 2026-11-23)
>
> [Apple 2.4.5(iv)](https://developer.apple.com/app-store/review/guidelines/#2.4.5), Mac App Store only, noted only:
> "They may not download or install standalone apps, kexts, additional code, or resources to add functionality or
> significantly change the app from what we see during the review process." (checked 2026-11-23)

- **Never:** installing packages (no `REQUEST_INSTALL_PACKAGES`), downloaded native code (dex, JAR, `.so`, dylibs), a
  JIT or any native code generated from widget source, host functions that pass a platform API through, and web views or
  browser engines as a widget runtime. Each would take widgets out of the interpreter exemption above.
- **Hosts:** all.

### (g) Generated per-widget apps are ruled out

> [Apple 4.2.6](https://developer.apple.com/app-store/review/guidelines/#4.2.6): "Apps created from a commercialized
> template or app generation service will be rejected unless they are submitted directly by the provider of the app’s
> content." (checked 2026-11-23)
>
> [Apple 4.3(a)](https://developer.apple.com/app-store/review/guidelines/#4.3): "Don’t create multiple Bundle IDs of the
> same app (for example, submitting a separate map app for every city in the world instead of a single worldwide map
> that allows users to search any city)." (checked 2026-11-23)
>
> [Android developer verification](https://developer.android.com/developer-verification/guides): "Android requires all
> apps to be registered by verified developers for users to install them on certified Android devices." and "we will
> expand these protections globally for all apps on certified Android devices in 2027." (checked 2026-11-23)

- **Ruled out:** turning a widget into its own iOS or Android app. On iOS it is a generated app (4.2.6) and a Bundle ID
  per widget (4.3(a)); 4.2.6 names the accepted alternative, "a single binary to host all client content". On Android
  each package would need registering by a verified developer to install on certified devices, and installing it from
  our app needs `REQUEST_INSTALL_PACKAGES`, which (f) rules out.
- **Hosts:** none.

## Open questions for Apple

1. Does a confined JavaScript interpreter that isn't WebKit, rendering native UI from a JSON view tree, count as
   "HTML5 and JavaScript mini apps" under 4.7?
2. Do native components drawn from the node schema, and a WebGPU subset replayed on Metal, "extend or expose native
   platform APIs or technologies" under 4.7.2, and does that need prior permission?
3. Is a widget the agent makes in the user's own session "software offered in your app" (4.7, with the 4.7.4 index and
   the 4.7.5 age gate), or only widgets shared by others?
4. For 4.7.3, is consent per widget template and host list enough, or is it needed per session or per request?
