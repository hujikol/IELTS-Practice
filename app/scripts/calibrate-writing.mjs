#!/usr/bin/env node

/**
 * IELTS Writing Calibration Harness (§7).
 * Evaluates configured model & prompt against human-assigned band fixtures (Bands 4.0 to 8.0).
 * Calculates mean, min, max, spread, and examiner bias.
 *
 * Usage:
 *   node scripts/calibrate-writing.mjs [--runs=3] [--dry-run]
 */

import { runWritingPreChecks } from '../src/lib/writing-checks.ts';
import { scoreWritingTask } from '../src/lib/writing-score.ts';
import { loadProviderConfig } from '../src/lib/providers.ts';

// 12 Fixture Essays with human examiner reference target bands (Tasks 1 & 2, Bands 4 to 8)
export const FIXTURES = [
  {
    id: 'w1_b5_underlength',
    task: 1,
    targetBand: 5.0,
    prompt: 'The chart shows water consumption in three sectors in 2000 and 2020.',
    text: 'The chart shows water in agriculture and industry. Agriculture used most water in 2000. In 2020 it was also high. Industry used less water than agriculture.',
  },
  {
    id: 'w1_b6_adequate',
    task: 1,
    targetBand: 6.0,
    prompt: 'The graph shows cinema attendance rates in a European city between 1990 and 2010.',
    text: 'The line graph illustrates the percentage of people attending cinemas across various age groups over a twenty year period from 1990 to 2010. Overall, young adults aged 15-24 represented the highest attendance throughout the timeline, whereas elderly citizens attended least frequently. For the youngest demographic, attendance began at roughly 55% in 1990 and increased to a peak of 70% in 2005 before dipping slightly. In contrast, those aged 65 and above remained under 20% throughout. Middle-aged groups showed moderate fluctuations.',
  },
  {
    id: 'w1_b7_strong',
    task: 1,
    targetBand: 7.0,
    prompt: 'The table compares daily energy consumption per household in five countries in 2015.',
    text: 'The table compares the average daily household energy consumption, measured in kilowatt-hours, across five distinct nations in 2015. Overall, Country A consumed by far the greatest amount of electricity per household, whereas Country E recorded the lowest figures. Notably, heating accounted for the dominant proportion of power usage in colder regions, contrasting with warmer nations where refrigeration and cooling predominated. Specifically, Country A households consumed 42 kWh daily, with heating comprising 28 kWh. By comparison, Country E used merely 14 kWh per day in total.',
  },
  {
    id: 'w1_b8_advanced',
    task: 1,
    targetBand: 8.0,
    prompt: 'The diagrams show the changes in an industrial harbour between 1980 and the present day.',
    text: 'The two maps delineate the comprehensive urban redevelopment of an industrial harbour area from 1980 to the present day. Overall, the formerly commercial docklands have undergone an extensive transformation into a mixed-use commercial, residential, and recreational waterfront zone. In 1980, the northern bank was dominated by cargo warehouses, cranes, and an adjoining freight railway. Today, these manufacturing installations have been entirely replaced by high-density residential apartments, flanked by a pedestrian promenade and public parks. Transportation infrastructure has simultaneously evolved from industrial rail to a modern light-rail passenger transit system.',
  },
  {
    id: 'w2_b4_tangential',
    task: 2,
    targetBand: 4.0,
    prompt: 'Some argue that international tourism does more harm than good to local communities. To what extent do you agree?',
    text: 'I like tourism very much because I travel to different countries with my family. When we travel we take many pictures and buy food in restaurants. Travelling is nice and people should do it every summer.',
  },
  {
    id: 'w2_b5_limited',
    task: 2,
    targetBand: 5.0,
    prompt: 'Some people think that university education should be free for everyone. Discuss both views.',
    text: 'University education is very important for all people. Some people think government must pay for university. Because young people have no money and need job. If university is free, everyone can go to study and get degree. But other people say university costs too much money. Teachers need salary and buildings need repair. So students should pay their own fee. In my opinion free university is good for poor students.',
  },
  {
    id: 'w2_b6_standard',
    task: 2,
    targetBand: 6.0,
    prompt: 'In many countries, traditional food is being replaced by fast food. What are the reasons and consequences?',
    text: 'In contemporary society, fast food has become increasingly prevalent, gradually replacing traditional cuisine in numerous households. There are several clear factors contributing to this trend, and it entails notable consequences for public health and cultural heritage. Firstly, fast-paced modern lifestyles leave working professionals with minimal time to prepare elaborate traditional recipes, making convenient fast food an appealing alternative. However, this shift leads to rising obesity rates, as processed meals typically contain excessive sodium, saturated fats, and artificial additives. To mitigate these adverse impacts, governments should actively promote traditional nutritional awareness.',
  },
  {
    id: 'w2_b7_developed',
    task: 2,
    targetBand: 7.0,
    prompt: 'Technological progress has made life easier, but has also increased stress. Discuss both views and give your opinion.',
    text: 'The proliferation of technological innovation over recent decades has fundamentally reshaped human existence, delivering unprecedented convenience while paradoxically heightening psychological pressure. While modern tools eliminate arduous manual labor, the expectation of constant connectivity has severely blurred the boundary between work and personal life. On the one hand, automation, high-speed computation, and digital communication platforms have streamlined professional productivity and global logistics. On the other hand, the pervasive intrusion of smartphones ensures employees remain perpetual recipients of workplace communications, inducing chronic cognitive fatigue. In my view, while technology affords undeniable practical benefits, maintaining rigorous personal boundaries is indispensable to avert burnout.',
  },
  {
    id: 'w2_b8_sophisticated',
    task: 2,
    targetBand: 8.0,
    prompt: 'Some believe that economic growth is the only way to end global poverty. Others argue that growth leads to environmental degradation and alternative solutions are required. Discuss both views and give your opinion.',
    text: 'The imperative to eradicate global poverty has generated intense debate regarding whether relentless economic expansion represents the sole viable mechanism, or whether its catastrophic ecological ramifications necessitate a radical conceptual pivot towards sustainable development models. While industrialized growth has historically elevated millions out of abject penury, unchecked industrial exploitation imperils planetary boundaries. Proponents of growth argue that capital accumulation directly fosters infrastructural modernization, industrial employment, and tax revenue essential for public health and universal education. However, unconstrained resource extraction precipitates climate instability, which disproportionately impacts impoverished communities. Consequently, true poverty alleviation cannot rely on orthodox growth alone; it mandates ecological stewardship and wealth redistribution.',
  },
];

export async function runCalibration(runsPerFixture = 1, dryRun = false) {
  console.log('='.repeat(70));
  console.log(`IELTS WRITING CALIBRATION HARNESS (${FIXTURES.length} fixtures, ${runsPerFixture} runs each)`);
  console.log('='.repeat(70));

  const config = loadProviderConfig();
  if (!dryRun && !config.enabled) {
    console.warn('⚠️ AI Provider is disabled. Running in dry-run mode (deterministic pre-checks only).\n');
  }

  const results = [];
  let totalDelta = 0;
  let countScored = 0;

  for (const f of FIXTURES) {
    const pre = runWritingPreChecks(f.task, f.prompt, f.text);
    const fixtureBands = [];

    for (let r = 0; r < runsPerFixture; r++) {
      if (dryRun || !config.enabled) {
        // In dry run, check pre-check behavior and length caps
        const simulated = pre.lengthCap !== null ? Math.min(f.targetBand, pre.lengthCap) : f.targetBand;
        fixtureBands.push(simulated);
      } else {
        const res = await scoreWritingTask(f.task, f.prompt, null, [], f.text, 1200, config);
        if (res.band !== null) {
          fixtureBands.push(res.band);
        }
      }
    }

    const mean = fixtureBands.length ? fixtureBands.reduce((a, b) => a + b, 0) / fixtureBands.length : null;
    const min = fixtureBands.length ? Math.min(...fixtureBands) : null;
    const max = fixtureBands.length ? Math.max(...fixtureBands) : null;
    const delta = mean !== null ? mean - f.targetBand : 0;

    if (mean !== null) {
      totalDelta += delta;
      countScored++;
    }

    results.push({
      id: f.id,
      task: `T${f.task}`,
      target: f.targetBand.toFixed(1),
      mean: mean !== null ? mean.toFixed(1) : 'N/A',
      spread: min !== null && max !== null ? (max - min).toFixed(1) : 'N/A',
      delta: delta >= 0 ? `+${delta.toFixed(1)}` : delta.toFixed(1),
      words: pre.wordCount,
      underLength: pre.isUnderLength ? 'YES' : 'NO',
      cap: pre.lengthCap ? pre.lengthCap.toFixed(1) : 'NONE',
    });
  }

  console.table(results);
  const avgBias = countScored ? (totalDelta / countScored).toFixed(2) : '0.00';
  console.log(`\nOverall Examiner Bias: ${avgBias >= 0 ? `+${avgBias}` : avgBias} bands across ${countScored} fixtures.`);
  console.log('='.repeat(70));
}

// CLI execution
if (process.argv[1]?.endsWith('calibrate-writing.mjs')) {
  const isDryRun = process.argv.includes('--dry-run');
  const runsArg = process.argv.find((a) => a.startsWith('--runs='));
  const runs = runsArg ? parseInt(runsArg.split('=')[1], 10) || 1 : 1;
  runCalibration(runs, isDryRun).catch(console.error);
}

