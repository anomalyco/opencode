import { expect, test } from "bun:test"
import path from "node:path"
import { runElectronFixture } from "../electron-run"

type Stores = { readonly profile: string[]; readonly remote: string[] }

type Calls = { readonly lists: number; readonly sites: number; readonly keys: number; readonly sets: number; readonly removes: number }

type Counted = Stores & { readonly calls: { readonly profile: Calls; readonly remote: Calls } }

// The mirror between the profile's cookies and a remote server's partition, on the pinned Electron's own cookie
// stores, which is where its cost was: Electron answers a read by domain, path and name by fetching every cookie the
// store holds, and the first copy made two such reads per cookie. Here each store's list is read once, a change asks
// each store for one site's cookies by address, and the cookies come out as they went in, whatever their kind.
test(
  "the pinned Electron's stores end up alike after one list read each, and a change costs one read of its site per store",
  async () => {
    const result: { before: Stores; copied: Counted; sameExpiries: boolean; followed: Counted; stopped: Stores; logged: string[] } = JSON.parse(
      await runElectronFixture({ fixture: path.join(import.meta.dir, "electron-link.fixture.ts") }),
    )

    expect(result.before.remote).toEqual([
      ".example.test/ domain=remote secure httpOnly persistent lax",
      ".remote.test/ remote=r secure script persistent lax",
      "www.example.test/ host=same secure script persistent strict",
    ])

    // Every kind of cookie arrives as it was: on a domain or one host, secure or plain, on a path, ending with the
    // session, and two of one name under one host. The profile's wins where both held one, and the partition's own
    // goes to the profile.
    const shared = [
      ".example.test/ domain=profile secure httpOnly persistent lax",
      ".example.test/ twin=of-the-domain secure script persistent lax",
      ".example.test/app domain=on-a-path secure script persistent lax",
      ".remote.test/ remote=r secure script persistent lax",
      "example.test/ ends=with-the-session secure script session lax",
      "example.test/ twin=of-the-host secure script persistent lax",
      "plain.test/ plain=p plain script persistent lax",
      "www.example.test/ host=same secure script persistent strict",
    ]

    expect(result.copied.profile).toEqual(shared)
    expect(result.copied.remote).toEqual(shared)
    expect(result.sameExpiries).toBe(true)
    // One read of each store's list, and only the differences written: six cookies into the partition, one into the
    // profile. The cookie both already shared is not written, and no store is asked for one cookie.
    expect(result.copied.calls).toEqual({
      profile: { lists: 1, sites: 0, keys: 0, sets: 1, removes: 0 },
      remote: { lists: 1, sites: 0, keys: 0, sets: 6, removes: 0 },
    })
    expect(result.logged).toEqual([
      "info browser sign-in copy started",
      "info browser sign-in copy finished profile=7 remote=3 toRemote=6 toProfile=1 refused=0",
    ])

    // Four changes, each made in one store by a page: a new value, a sign-out, a new cookie on a path, and one of the
    // twins. Each reached the other store and left its twin alone.
    const followed = [
      ".example.test/ domain=profile secure httpOnly persistent lax",
      ".example.test/ twin=of-the-domain secure script persistent lax",
      ".example.test/app domain=on-a-path secure script persistent lax",
      ".remote.test/ remote=r secure script persistent lax",
      "example.test/ ends=with-the-session secure script session lax",
      "example.test/ twin=changed-on-the-host secure script persistent lax",
      "new.test/deep/er fresh=f secure httpOnly persistent lax",
      "www.example.test/ host=signed-in-again secure script persistent strict",
    ]

    expect(result.followed.profile).toEqual(followed)
    expect(result.followed.remote).toEqual(followed)
    // Each change cost each store one read of that site's cookies and one write in the other store. The echoes of
    // those writes cost nothing, and no list was read again.
    expect(result.followed.calls).toEqual({
      profile: { lists: 1, sites: 4, keys: 0, sets: 3, removes: 1 },
      remote: { lists: 1, sites: 4, keys: 0, sets: 7, removes: 0 },
    })

    // No longer shared: the partition keeps none of it, the profile all of it.
    expect(result.stopped).toEqual({ profile: followed, remote: [] })
  },
  // Starting Electron takes seconds on a loaded runner.
  60_000,
)
