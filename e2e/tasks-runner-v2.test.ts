import {
  ensureProject,
  forEachCli,
  listFiles,
  newProject,
  rmDist,
  runCLI,
  runCommand,
  uniq,
  updateFile
} from './utils';

forEachCli(() => {
  describe('Task Runner V2', () => {
    describe('run-one with deps', () => {
      it('should be able to run tasks in parallel', () => {
        newProject();

        updateFile('nx.json', c => {
          const nxJson = JSON.parse(c);
          nxJson.tasksRunnerOptions = {
            default: {
              runner: '@nrwl/workspace/src/tasks-runner/tasks-runner-v2',
              options: {
                cacheableOperations: ['build', 'test', 'lint']
              }
            }
          };
          return JSON.stringify(nxJson, null, 2);
        });

        const myapp = uniq('myapp');
        const mylib1 = uniq('mylib1');
        const mylib2 = uniq('mylib1');
        runCLI(`generate @nrwl/react:app ${myapp}`);
        runCLI(`generate @nrwl/workspace:lib ${mylib1}`);
        runCLI(`generate @nrwl/workspace:lib ${mylib2}`);

        updateFile(
          `apps/${myapp}/src/main.ts`,
          `
          import "@proj/${mylib1}";
          import "@proj/${mylib2}";
        `
        );

        const testsWithDeps = runCLI(`test ${myapp} --with-deps`);
        expect(testsWithDeps).toContain(
          `NX  Running target test for projects:`
        );
        expect(testsWithDeps).toContain(myapp);
        expect(testsWithDeps).toContain(mylib1);
        expect(testsWithDeps).toContain(mylib2);

        const testsWithoutDeps = runCLI(`test ${myapp}`);
        expect(testsWithoutDeps).not.toContain(mylib1);
      });
    });

    describe('Cache', () => {
      it('should cache command execution', async () => {
        newProject();

        const myapp1 = uniq('myapp1');
        const myapp2 = uniq('myapp2');
        runCLI(`generate @nrwl/web:app ${myapp1}`);
        runCLI(`generate @nrwl/web:app ${myapp2}`);
        const files = `--files="apps/${myapp1}/src/main.ts,apps/${myapp2}/src/main.ts"`;

        // run without caching
        // --------------------------------------------
        const outputWithoutCachingEnabled1 = runCommand(
          `npm run affected:build -- ${files}`
        );
        const filesApp1 = listFiles(`dist/apps/${myapp1}`);
        const filesApp2 = listFiles(`dist/apps/${myapp2}`);

        expect(outputWithoutCachingEnabled1).not.toContain(
          'read the output from cache'
        );

        const outputWithoutCachingEnabled2 = runCommand(
          `npm run affected:build -- ${files}`
        );
        expect(outputWithoutCachingEnabled2).not.toContain(
          'read the output from cache'
        );

        // enable caching
        // --------------------------------------------
        updateFile('nx.json', c => {
          const nxJson = JSON.parse(c);
          nxJson.tasksRunnerOptions = {
            default: {
              runner: '@nrwl/workspace/src/tasks-runner/tasks-runner-v2',
              options: {
                cacheableOperations: ['build', 'test', 'lint']
              }
            }
          };
          return JSON.stringify(nxJson, null, 2);
        });

        // run build with caching
        // --------------------------------------------
        const outputThatPutsDataIntoCache = runCommand(
          `npm run affected:build -- ${files}`
        );
        // now the data is in cache
        expect(outputThatPutsDataIntoCache).not.toContain(
          'read the output from cache'
        );

        rmDist();

        const outputWithBothBuildTasksCached = runCommand(
          `npm run affected:build -- ${files}`
        );
        expect(outputWithBothBuildTasksCached).toContain(
          'read the output from cache'
        );
        expectCached(outputWithBothBuildTasksCached, [myapp1, myapp2]);
        expect(listFiles(`dist/apps/${myapp1}`)).toEqual(filesApp1);
        expect(listFiles(`dist/apps/${myapp2}`)).toEqual(filesApp2);

        // run with skipping cache
        const outputWithBothBuildTasksCachedButSkipped = runCommand(
          `npm run affected:build -- ${files} --skip-nx-cache`
        );
        expect(outputWithBothBuildTasksCachedButSkipped).not.toContain(
          `read the output from cache`
        );

        // touch myapp1
        // --------------------------------------------
        updateFile(`apps/${myapp1}/src/main.ts`, c => {
          return `${c}\n//some comment`;
        });
        const outputWithBuildApp2Cached = runCommand(
          `npm run affected:build -- ${files}`
        );
        expect(outputWithBuildApp2Cached).toContain(
          'read the output from cache'
        );
        expectCached(outputWithBuildApp2Cached, [myapp2]);

        // touch package.json
        // --------------------------------------------
        updateFile(`package.json`, c => {
          const r = JSON.parse(c);
          r.description = 'different';
          return JSON.stringify(r);
        });
        const outputWithNoBuildCached = runCommand(
          `npm run affected:build -- ${files}`
        );
        expect(outputWithNoBuildCached).not.toContain(
          'read the output from cache'
        );

        // build individual project with caching
        const individualBuildWithCache = runCommand(
          `npm run nx -- build ${myapp1}`
        );
        expect(individualBuildWithCache).toContain('Cached Output');

        // skip caching when building individual projects
        const individualBuildWithSkippedCache = runCommand(
          `npm run nx -- build ${myapp1} --skip-nx-cache`
        );
        expect(individualBuildWithSkippedCache).not.toContain('Cached Output');

        // run lint with caching
        // --------------------------------------------
        const outputWithNoLintCached = runCommand(
          `npm run affected:lint -- ${files}`
        );
        expect(outputWithNoLintCached).not.toContain(
          'read the output from cache'
        );

        const outputWithBothLintTasksCached = runCommand(
          `npm run affected:lint -- ${files}`
        );
        expect(outputWithBothLintTasksCached).toContain(
          'read the output from cache'
        );
        expectCached(outputWithBothLintTasksCached, [
          myapp1,
          myapp2,
          `${myapp1}-e2e`,
          `${myapp2}-e2e`
        ]);
      }, 120000);
    });
  });

  function expectCached(actual: string, expected: string[]) {
    const section = actual.split('read the output from cache')[1];
    const r = section
      .split('\n')
      .filter(l => l.trim().startsWith('-'))
      .map(l => l.split('- ')[1].trim());
    r.sort((a, b) => a.localeCompare(b));
    expected.sort((a, b) => a.localeCompare(b));
    expect(r).toEqual(expected);
  }
});
