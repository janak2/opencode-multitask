import { getFilename } from "@opencode/util/path"
import type { ProjectUpdateInput } from "@opencode/client/promise"
import { createMemo } from "solid-js"
import { createStore } from "solid-js/store"
import { useGlobal } from "@/runtime/server/runtime"
import { useLanguage } from "@/runtime/i18n/language"
import type { LocalProject } from "@/shell/state/layout"
import { ServerConnection } from "@/runtime/server/registry"
import { showToast } from "@/shell/notifications/toast"
import { homeProjectDirectories } from "@/shell/layout/helpers"
import { useDirectoryPicker } from "@/workspaces/selection/picker"

type ProjectPatch = Pick<ProjectUpdateInput, "name" | "icon" | "commands" | "folders">

export function createEditProjectModel(props: { project: LocalProject; server: ServerConnection.Any }) {
  const language = useLanguage()
  const pickDirectory = useDirectoryPicker()
  const global = useGlobal()
  const serverCtx = createMemo(() => global.ensureServerCtx(props.server))
  const folderName = createMemo(() => getFilename(props.project.worktree))
  const defaultName = createMemo(() => props.project.name || folderName())

  const [store, setStore] = createStore({
    name: defaultName(),
    color: props.project.icon?.color,
    iconOverride: props.project.icon?.override,
    startup: props.project.commands?.start ?? "",
    folders: [...(props.project.folders ?? [])],
    dragOver: false,
    iconHover: false,
    saving: 0,
  })

  const saved = {
    name: props.project.name ?? "",
    startup: store.startup.trim(),
    color: store.color,
    iconOverride: store.iconOverride,
  }

  let iconInput: HTMLInputElement | undefined
  let queue = Promise.resolve()

  const persist = (patch: ProjectPatch, complete: () => void) => {
    setStore("saving", (value) => value + 1)
    queue = queue
      .then(async () => {
        if (props.project.id && props.project.id !== "global") {
          const project = await serverCtx().sdk.api.project.update({ projectID: props.project.id, ...patch })
          serverCtx().sync.project.update(project)

          return
        }

        serverCtx().sync.project.meta(props.project.worktree, patch)
      })
      .then(complete)
      .catch((error: unknown) => {
        showToast({
          variant: "error",
          title: language.t("common.requestFailed"),
          description: error instanceof Error ? error.message : language.t("common.requestFailed"),
        })
      })
      .finally(() => setStore("saving", (value) => value - 1))
  }

  const saveName = () => {
    const value = store.name.trim() === folderName() ? "" : store.name.trim()

    // A pending write can change the saved value, so reverting to it must still be queued.
    if (!store.saving && value === saved.name) return
    persist({ name: value }, () => {
      saved.name = value
    })
  }

  const saveStartup = () => {
    const value = store.startup.trim()

    if (!store.saving && value === saved.startup) return
    persist({ commands: { start: value } }, () => {
      saved.startup = value
    })
  }

  const saveIcon = (color = store.color, override = store.iconOverride) => {
    if (!store.saving && color === saved.color && override === saved.iconOverride) return
    persist({ icon: { color: color ?? "", override: override ?? "" } }, () => {
      saved.color = color
      saved.iconOverride = override
    })
  }

  const saveFolders = (folders: string[]) => {
    setStore("folders", folders)
    persist({ folders }, () => {})
  }

  function selectFile(file: File) {
    if (!file.type.startsWith("image/")) return
    const reader = new FileReader()
    reader.onload = (event) => {
      const result = event.target?.result

      if (typeof result !== "string") return
      setStore("iconOverride", result)
      setStore("iconHover", false)
      saveIcon(store.color, result)
    }

    reader.readAsDataURL(file)
  }

  return {
    store,
    setStore,
    folderName,
    defaultName,
    saveName,
    saveStartup,
    addFolders() {
      pickDirectory({
        server: props.server,
        title: language.t("project.settings.folders.add"),
        multiple: true,
        onSelect: (result) => {
          const added = homeProjectDirectories(result).filter(
            (folder) => folder !== props.project.worktree && !store.folders.includes(folder),
          )

          if (added.length) saveFolders([...store.folders, ...new Set(added)])
        },
      })
    },
    removeFolder(folder: string) {
      saveFolders(store.folders.filter((item) => item !== folder))
    },
    setColor(value: string | undefined) {
      setStore("color", value)
      saveIcon(value, store.iconOverride)
    },
    drop(event: DragEvent) {
      event.preventDefault()
      setStore("dragOver", false)
      const file = event.dataTransfer?.files[0]

      if (file) selectFile(file)
    },
    dragOver(event: DragEvent) {
      event.preventDefault()
      setStore("dragOver", true)
    },
    dragLeave() {
      setStore("dragOver", false)
    },
    inputChange(input: HTMLInputElement) {
      const file = input.files?.[0]

      if (file) selectFile(file)
    },
    iconClick() {
      if (store.iconOverride && store.iconHover) {
        setStore("iconOverride", "")
        saveIcon(store.color, "")

        return
      }

      iconInput?.click()
    },
    setIconInput(input: HTMLInputElement) {
      iconInput = input
    },
  }
}
