import type { Profile, Sheet } from '../types.ts';
import { emergencyProfile } from './emergency.ts';
import { energyProfile } from './energy.ts';
import { genericProfile } from './generic.ts';
import { greenProfile, yardContractsProfile, yardsApprovedProfile, yardsDesignProfile } from './improvement.ts';
import { repairProfile, roadsProfile } from './repair.ts';
import { liftsProfile } from './lifts.ts';
import { mkdProfile } from './mkd.ts';
import { mkdGeoProfile } from './mkdGeo.ts';
import { thermoProfile } from './thermo.ts';

/** Профили в порядке проверки; generic — последний (подходит для любой таблицы). */
export const PROFILES: Profile[] = [
  mkdProfile, energyProfile, thermoProfile, liftsProfile, repairProfile, yardContractsProfile, yardsApprovedProfile, yardsDesignProfile, greenProfile, roadsProfile, emergencyProfile, mkdGeoProfile,
  genericProfile,
];

export function profileByCode(code: string): Profile | undefined {
  return PROFILES.find((p) => p.code === code);
}

export function detectProfile(sheet: Sheet): Profile {
  return PROFILES.find((p) => p.code !== 'generic' && p.detect(sheet)) ?? genericProfile;
}
