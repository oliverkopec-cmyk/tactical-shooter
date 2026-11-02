// The graphics setting: 'high', 'low', or 'auto' (low on weak devices: little memory, few cores, or a phone).

import { settings } from './settings.js';

function weakDevice() {
  const mem = navigator.deviceMemory, cores = navigator.hardwareConcurrency;
  return (mem !== undefined && mem <= 4) || (cores !== undefined && cores <= 2) || /Mobi|Android/i.test(navigator.userAgent);
}

/** True when effects should be turned down. */
export const lowGraphics = () => settings.graphics === 'low' || (settings.graphics === 'auto' && weakDevice());
