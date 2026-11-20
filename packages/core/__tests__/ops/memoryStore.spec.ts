import { kitRegistry } from '../kit.ts'
import { memoryStore } from '../../src/ops/memoryStore.ts'
import { storeContract } from './storeContract.ts'

storeContract('memory', async doc => ({
  store: memoryStore({ s: doc }),
  site: 's',
  registry: kitRegistry(),
}))
