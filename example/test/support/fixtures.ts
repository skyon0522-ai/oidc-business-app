import { adminClient } from './admin-client.ts'
import { test as sourceTest, createTestBed } from './testbed.ts'

export const test = sourceTest.extend({
  bed: async ({ page, appUrl, authServerUrl }, use) => {
    const bed = await createTestBed(page, { appUrl, authServerUrl })
    try {
      await use(bed)
    } finally {
      await adminClient.realms.del({ realm: bed.realm })
    }
  }
})

export { expect } from '@playwright/test'
