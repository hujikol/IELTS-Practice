// §5.2 single-source adapter. `material.requirements()` owns every schema, numeric
// constraint and rule sentence; the guide renderer only formats. This file is the one
// place the two meet, so prompt text cannot drift from the validation contract.
import { requirements, type Requirements } from './material.ts';
import type { PrepJob, TestData } from './types.ts';
import type { GuideBrief, GuideConstraint, GuideRequirements } from './guide.ts';

const constraint = (text: string, id: string): GuideConstraint => ({ id, text });

const partLabel = (job: PrepJob): string => {
  if (job.section === 'listening') return `Part ${job.part}`;
  if (job.section === 'reading') return `Passage ${job.part}`;
  if (job.section === 'writing') return job.part === 0 ? 'Tasks 1 and 2' : `Task ${job.part}`;
  return job.part === 0 ? 'Parts 1, 2 and 3' : `Part ${job.part}`;
};

const briefFrom = (t: TestData, spec: Requirements): GuideBrief => ({
  section: spec.job.section,
  part_label: partLabel(spec.job),
  seed: t.seed,
  focus_skill: t.focusSkill || 'balanced',
  structure: spec.brief.split('. ').filter((s) => s.trim() !== ''),
  previous_topics: [...t.listening, ...t.reading]
    .filter((b) => b && b.title.trim() !== '')
    .map((b) => b.title),
});

/** Derive the guide's view of a job from the material contract. */
export function guideRequirements(t: TestData, job: PrepJob): GuideRequirements {
  const spec = requirements(t, job);
  return {
    job,
    schema: { $comment: 'Material schema is enforced by import validation; see the hard rules below.' },
    constraints: {
      hard: spec.constraints.map((text, i) => constraint(text, `hard_${i + 1}`)),
      targets: spec.targets.map((text, i) => constraint(text, `target_${i + 1}`)),
      self_check: [
        constraint('Every declared field is present and no extra field appears.', 'self_check_shape'),
        constraint('Question counts, group ranges and word limits match the hard rules exactly.', 'self_check_counts'),
        constraint('Group ranges tile the question numbers with no gap and no overlap.', 'self_check_groups'),
        constraint('Gap answers and evidence quotes are copied word-for-word from the source text.', 'self_check_verbatim'),
        constraint('correct is a zero-based index into the options actually emitted.', 'self_check_index'),
        constraint('format_version, attempt_id, job_key and generation_id match exactly.', 'self_check_identity'),
        constraint('The response is valid JSON with no unescaped quotes or line breaks inside strings.', 'self_check_escaping'),
      ],
    },
    brief: briefFrom(t, spec),
  };
}
