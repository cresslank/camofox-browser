import { createClient } from '../helpers/client.js';
import { getSharedEnv } from './sharedEnv.js';

describe('click actionability and outcome semantics', () => {
  let serverUrl;

  beforeAll(() => {
    serverUrl = getSharedEnv().serverUrl;
  });

  test('real route rejects non-actionable targets, reports real success, and does not replay an ambiguous click', async () => {
    const client = createClient(serverUrl);
    try {
      const { tabId } = await client.createTab();
      await client.evaluate(tabId, `(() => {
        document.body.innerHTML = \`
          <button id="visible">visible</button>
          <button id="hidden" style="display:none">hidden</button>
          <button id="disabled" disabled>disabled</button>
          <div style="position:relative;width:200px;height:60px">
            <button id="covered">covered</button>
            <div style="position:absolute;inset:0;z-index:2"></div>
          </div>
          <button id="removed">removed</button>
          <button id="slow">slow</button>\`;
        window.clickCounts = { visible: 0, hidden: 0, disabled: 0, covered: 0, removed: 0, slow: 0 };
        for (const id of Object.keys(window.clickCounts)) {
          document.getElementById(id).addEventListener('click', () => window.clickCounts[id]++);
        }
        document.getElementById('removed').remove();
        document.getElementById('slow').addEventListener('click', () => {
          const end = Date.now() + 3500;
          while (Date.now() < end) {}
        });
        return true;
      })()`);

      const success = await client.click(tabId, { selector: '#visible' });
      expect(success.ok).toBe(true);
      expect((await client.evaluate(tabId, 'window.clickCounts.visible')).result).toBe(1);

      for (const target of ['hidden', 'disabled', 'covered', 'removed']) {
        let error;
        try {
          await client.click(tabId, { selector: `#${target}` });
        } catch (caught) {
          error = caught;
        }
        expect(error?.status).toBe(422);
        expect(error?.data?.code).toBe('element_not_actionable');
        expect((await client.evaluate(tabId, `window.clickCounts.${target}`)).result).toBe(0);
      }

      let ambiguous;
      try {
        await client.click(tabId, { selector: '#slow' });
      } catch (caught) {
        ambiguous = caught;
      }
      expect(ambiguous?.status).toBe(409);
      expect(ambiguous?.data).toMatchObject({
        code: 'click_outcome_unknown',
        outcome: 'unknown',
        retryable: false,
      });
      expect((await client.evaluate(tabId, 'window.clickCounts.slow')).result).toBe(1);
    } finally {
      await client.cleanup();
    }
  }, 60000);
});
