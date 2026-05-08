type AttemptedJob = {
  attemptsMade?: number;
  opts?: {
    attempts?: number;
  };
};

export function hasExhaustedAttempts(job: AttemptedJob | null | undefined): boolean {
  if (!job) {
    return false;
  }

  const attemptsMade = Number(job.attemptsMade || 0);
  const maxAttempts = Math.max(1, Number(job.opts?.attempts || 1));
  return attemptsMade >= maxAttempts;
}
