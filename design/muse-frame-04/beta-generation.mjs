import {tr} from './language.mjs';
const DEFAULT = 'default';

export function pixelRatio(value) {
  const match = /^(\d+)[*x×](\d+)$/.exec(value);
  if (!match) return null;
  const width = Number(match[1]), height = Number(match[2]);
  if (!width || !height) return null;
  let a = width, b = height;
  while (b) [a, b] = [b, a % b];
  return `${width / a}:${height / a}`;
}

export function outputChoices(schema, draft = {}) {
  const values = key => [...new Set((schema?.properties?.[key]?.enum || [])
    .filter(value => typeof value === 'string' && value && value !== DEFAULT))];
  const sizes = values('size');
  const resolutions = values('resolution');
  const ratios = values('aspect_ratio');
  const dimensions = sizes.length ? sizes : resolutions.every(pixelRatio) ? resolutions : [];
  const ratioValues = dimensions.length ? [...new Set(dimensions.map(pixelRatio).filter(Boolean))] : ratios;
  const valid = (options, value) => options.includes(value) ? value : DEFAULT;
  const ratio = valid(ratioValues, draft.ratio);
  const available = dimensions.filter(value => ratio === DEFAULT || pixelRatio(value) === ratio);
  const size = valid(available, draft.size);
  const resolution = valid(dimensions.length ? available : resolutions, draft.resolution);
  const exact = sizes.length ? size : dimensions.length ? resolution : null;
  const settings = {
    ratio: exact && exact !== DEFAULT ? pixelRatio(exact) || DEFAULT : ratio,
    resolution: sizes.length ? DEFAULT : resolution,
    size: sizes.length && size !== DEFAULT ? size : null,
  };

  // A model with pixel dimensions accepts only the concrete native dimension.
  // If a ratio is picked first, choose a supported size of that shape.
  if (dimensions.length && ratio !== DEFAULT && exact === DEFAULT && available.length) {
    if (sizes.length) settings.size = available[0];
    else settings.resolution = available[0];
  }
  return {settings, ratios:ratioValues, clarity:dimensions.length ? available : resolutions,
    clarityKey:sizes.length ? 'size' : 'resolution', dimensions:Boolean(dimensions.length)};
}

export function outputSummary(settings) {
  const ratio = settings.ratio === DEFAULT ? tr("平台默认比例") : settings.ratio;
  const clarity = settings.size || (settings.resolution === DEFAULT ? tr("平台默认清晰度") : settings.resolution);
  return `${ratio} · ${clarity}`;
}
