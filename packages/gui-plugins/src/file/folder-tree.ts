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

  const ensure = (path: string) => {
    if (!store.dir[path]) setStore("dir", path, { expanded: false })
  }

  const sync = (path: string, options?: { readonly force?: boolean }) => {
    ensure(path)

    if (!options?.force && store.dir[path]?.loaded) return Promise.resolve()
    const pending = inflight.get(path)

    if (pending) return pending
    setStore("dir", path, { loading: true, error: undefined })

    const promise = input
      .client()
      .file.list({ location: { directory: input.folder }, path: path || undefined })
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
          path,
          produce((draft) => {
            draft.loaded = true
            draft.loading = false
            draft.children = children
          }),
        )
      })
      .catch((error: Error) => {
        setStore("dir", path, { loading: false, error: error.message })
        input.onError(error.message)
      })
      .finally(() => inflight.delete(path))

    inflight.set(path, promise)

    return promise
  }

  return {
    list: (path) => store.dir[path]?.children ?? [],
    state: (path) => store.dir[path],
    sync,
    expand(path, options) {
      ensure(path)
      setStore("dir", path, "expanded", true)

      if (options?.list !== false) void sync(path)
    },
    collapse(path) {
      ensure(path)
      setStore("dir", path, "expanded", false)
    },
  }
}
