import {describe, expect, it} from 'vitest';
import {TAB_TTL_MS, withTab} from './daemon.js';

const chrome = {app: 'google-chrome', title: 'New Tab - Google Chrome'};
const tab = {host: 'netflix.com', pageTitle: 'Netflix'};

describe('withTab', () => {
  it('merges a fresh tab report into a browser window', () => {
    expect(withTab(chrome, tab, 1000)).toMatchObject({host: 'netflix.com', pageTitle: 'Netflix'});
  });

  it('drops a report older than the TTL, so a dead extension cannot haunt every browser window', () => {
    expect(withTab(chrome, tab, TAB_TTL_MS + 1)).toEqual(chrome);
  });
});
