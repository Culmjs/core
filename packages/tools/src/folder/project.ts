import type { Links, Registry } from '@culmjs/core'
import { loadFiles, readFolder, type Loaded } from './load.ts'
import { readHeld } from './held.ts'
import { loadPlugins, type ProjectConfig } from './plugins.ts'

export type Project = {
  dir: string
  registry: Registry
  config: ProjectConfig
  loaded: Loaded
  links: Links
  /** What the folder holds that a build uses (fonts so far). */
  held: Awaited<ReturnType<typeof readHeld>>
}

/**
 * The registry, the loaded document and the links for a build. The disk is read once; the problems of the plug-ins and of loading
 * are together in `loaded.problems`, each once. Writes nothing, and does not open `.culm/`.
 */
export async function openProject(dir: string): Promise<Project> {
  const { files, refused, unreadable } = await readFolder(dir)
  const { registry, config, problems } = await loadPlugins(dir, files)
  const loaded = await loadFiles(
    files,
    registry,
    { alreadyReported: true },
    refused,
  )
  loaded.problems.unshift(...(unreadable ? [unreadable] : []), ...problems)
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
