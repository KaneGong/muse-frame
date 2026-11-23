import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';

export const name = 'muse-frame-shot-planner';
export const inject = ['skills'];

const directory = new URL('./skills/shot-planner/', import.meta.url);
const locator = new URL('SKILL.md', directory);
const skill = {
  name: 'shot-planner',
  provider: name,
  description: 'Prepare a Muse Frame portrait shot plan to import into the desktop studio.',
  invocation: {modelInvocable: true, userInvocable: true},
  source: 'bundled',
  resourceBase: {kind: 'directory', path: fileURLToPath(directory)},
};

export function apply(ctx) {
  ctx.skills.registerProvider(() => ({
    name,
    list: async () => [{...skill, locator, rank: 0}],
    get: async () => ({...skill, content: await readFile(locator, 'utf8')}),
  }));
}
