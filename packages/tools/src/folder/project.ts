import type { Links, Registry } from '@culmjs/core'
import { loadFiles, readProject, type Loaded } from './load.ts'
import { loadPlugins, type ProjectConfig } from './plugins.ts'

export type Project = {
  dir: string
  registry: Registry
  config: ProjectConfig
  loaded: Loaded
  links: Links
}

/**
 * The registry, the loaded document and the links for a build. The disk is read once; the problems of the plug-ins and of loading
 * are together in `loaded.problems`, each once. Writes nothing, and does not open `.culm/`.
 */
export async function openProject(dir: string): Promise<Project> {
  const files = await readProject(dir)
  const { registry, config, problems } = await loadPlugins(dir, files)
  const loaded = await loadFiles(files, registry, { alreadyReported: true })
  loaded.problems.unshift(...problems)
  return {
    dir,
    registry,
    config,
    loaded,
    // no `page`: the default, the slug itself, is right
    links: { page: slug => slug, file: id => `/assets/${id}` },
  }
}
