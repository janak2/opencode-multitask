import { createStore, produce } from "solid-js/store"
import { getFilename } from "@opencode/util/path"
import type { FileNode, Files, ServerRef } from "@opencode/plugin/gui"

type DirectoryState = {
  expanded: boolean
  loaded?: boolean
  loading?: boolean
  error?: string
  children?: FileNode[]
}

/** A file tree of one project folder outside the session's workspace, listed one directory at a time. */
export function createFolderTree(input: {
  client: () => ServerRef["client"]
  folder: string
  onError: (message: string) => void
}): Files["tree"] {
  const [store, setStore] = createStore<{ dir: Record<string, DirectoryState> }>({ dir: { "": { expanded: true } } })
  const inflight = new Map<string, Promise<void>>()
  // The server lists directories with a trailing separator; "src" and "src/" are one directory.
  const key = (path: string) => path.replace(/[\\/]+$/, "")

  const ensure = (dir: string) => {
    if (!store.dir[dir]) setStore("dir", dir, { expanded: false })
  }

  const sync = (path: string, options?: { readonly force?: boolean }) => {
    const dir = key(path)
    ensure(dir)

    if (!options?.force && store.dir[dir]?.loaded) return Promise.resolve()
    const pending = inflight.get(dir)

    if (pending) return pending
    setStore("dir", dir, { loading: true, error: undefined })

    const promise = input
      .client()
      .file.list({ location: { directory: input.folder }, path: dir || undefined })
      .then((result) => {
        const children = result.data.map(
          (entry): FileNode => ({
            name: getFilename(entry.path),
            path: entry.path,
            absolute: `${input.folder}/${entry.path}`,
            type: entry.type,
            ignored: false,
          }),
        )

        setStore(
          "dir",
          dir,
          produce((draft) => {
            draft.loaded = true
            draft.loading = false
            draft.children = children
          }),
        )
      })
      .catch((error: Error) => {
        setStore("dir", dir, { loading: false, error: error.message })
        input.onError(error.message)
      })
      .finally(() => inflight.delete(dir))

    inflight.set(dir, promise)

    return promise
  }

  return {
    list: (path) => store.dir[key(path)]?.children ?? [],
    state: (path) => store.dir[key(path)],
    sync,
    expand(path, options) {
      const dir = key(path)
      ensure(dir)
      setStore("dir", dir, "expanded", true)

      if (options?.list !== false) void sync(dir)
    },
    collapse(path) {
      const dir = key(path)
      ensure(dir)
      setStore("dir", dir, "expanded", false)
    },
  }
}
