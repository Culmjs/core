import { resolve } from 'node:path'
import type { Links, Registry } from '@culmjs/core'
import {
  folderFingerprint,
  loadFiles,
  readFolder,
  type Loaded,
} from './load.ts'
import { readHeld } from './held.ts'
import {
  loadPlugins,
  readByPlugins,
  type Located,
  type ProjectConfig,
} from './plugins.ts'

export type Project = {
  dir: string
  registry: Registry
  config: ProjectConfig
  loaded: Loaded
  links: Links
  /** What the folder holds that a build uses (fonts so far). */
  held: Awaited<ReturnType<typeof readHeld>>
}

type CachedProject = {
  fp: string
  pluginFp: string
  registry: Registry
  config: ProjectConfig
  pluginProblems: Located[]
  loaded: Loaded
}

const projectCache = new Map<string, CachedProject>()

const filterBy = (
  m: ReadonlyMap<string, string>,
  pred: (k: string) => boolean,
) => new Map([...m].filter(([k]) => pred(k)))

/**
 * The registry, the loaded document and the links for a build. The disk is read once; the problems of the plug-ins and of loading
 * are together in `loaded.problems`, each once. Writes nothing, and does not open `.culm/`.
 */
export async function openProject(dir: string): Promise<Project> {
  const abs = resolve(dir)
  const { files, refused, unreadable } = await readFolder(dir)
  if (!unreadable) {
    const fp = folderFingerprint(files, refused)
    const pluginFp = folderFingerprint(
      filterBy(files, readByPlugins),
      filterBy(refused, readByPlugins),
    )
    const cached = projectCache.get(abs)
    const hasCustomPlugin = (cached?.config.plugins.length ?? 0) > 0
    if (cached && !hasCustomPlugin && cached.fp === fp) {
      return {
        dir,
        registry: cached.registry,
        config: cached.config,
        loaded: {
          ...cached.loaded,
          doc:
            cached.loaded.doc === undefined
              ? undefined
              : structuredClone(cached.loaded.doc),
          data: structuredClone(cached.loaded.data),
          problems: [...cached.loaded.problems],
          notices: [...cached.loaded.notices],
          files: [...cached.loaded.files],
        },
        held: await readHeld(dir),
        links: { page: slug => slug, file: id => `/assets/${id}` },
      }
    }
    const canReusePlugins =
      cached && !hasCustomPlugin && cached.pluginFp === pluginFp
    const plugins = canReusePlugins
      ? {
          registry: cached.registry,
          config: cached.config,
          problems: cached.pluginProblems,
        }
      : await loadPlugins(dir, files)
    const loaded = await loadFiles(
      files,
      plugins.registry,
      { alreadyReported: true },
      refused,
    )
    loaded.problems.unshift(...plugins.problems)
    if (!plugins.config.plugins.length) {
      projectCache.set(abs, {
        fp,
        pluginFp,
        registry: plugins.registry,
        config: plugins.config,
        pluginProblems: [...plugins.problems],
        loaded: {
          ...loaded,
          doc:
            loaded.doc === undefined ? undefined : structuredClone(loaded.doc),
          data: structuredClone(loaded.data),
          problems: [...loaded.problems],
          notices: [...loaded.notices],
          files: [...loaded.files],
        },
      })
    } else projectCache.delete(abs)
    return {
      dir,
      registry: plugins.registry,
      config: plugins.config,
      loaded,
      held: await readHeld(dir),
      // no `page`: the default, the slug itself, is right
      links: { page: slug => slug, file: id => `/assets/${id}` },
    }
  }
  const { registry, config, problems } = await loadPlugins(dir, files)
  const loaded = await loadFiles(
    files,
    registry,
    { alreadyReported: true },
    refused,
  )
  loaded.problems.unshift(unreadable, ...problems)
  return {
    dir,
    registry,
    config,
    loaded,
    held: await readHeld(dir),
    // no `page`: the default, the slug itself, is right
    links: { page: slug => slug, file: id => `/assets/${id}` },
  }
}
