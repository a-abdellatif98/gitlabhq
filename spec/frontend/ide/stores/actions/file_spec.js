import MockAdapter from 'axios-mock-adapter';
import { nextTick } from 'vue';
import eventHub from '~/ide/eventhub';
import { createRouter } from '~/ide/ide_router';
import service from '~/ide/services';
import { createStore } from '~/ide/stores';
import * as actions from '~/ide/stores/actions/file';
import * as types from '~/ide/stores/mutation_types';
import axios from '~/lib/utils/axios_utils';
import { stubPerformanceWebAPI } from 'helpers/performance';
import { file, createTriggerRenameAction, createTriggerUpdatePayload } from '../../helpers';

const ORIGINAL_CONTENT = 'original content';
const RELATIVE_URL_ROOT = '/gitlab';

describe('IDE store file actions', () => {
  let mock;
  let originalGon;
  let store;
  let router;

  beforeEach(() => {
    stubPerformanceWebAPI();

    mock = new MockAdapter(axios);
    originalGon = window.gon;
    window.gon = {
      ...window.gon,
      relative_url_root: RELATIVE_URL_ROOT,
    };

    store = createStore();

    store.state.currentProjectId = 'test/test';
    store.state.currentBranchId = 'main';

    router = createRouter(store);

    jest.spyOn(store, 'commit');
    jest.spyOn(store, 'dispatch');
    jest.spyOn(router, 'push').mockImplementation(() => {});
  });

  afterEach(() => {
    mock.restore();
    window.gon = originalGon;
  });

  describe('closeFile', () => {
    let localFile;

    beforeEach(() => {
      localFile = file('testFile');
      localFile.active = true;
      localFile.opened = true;

      store.state.openFiles.push(localFile);
      store.state.entries[localFile.path] = localFile;
    });

    it('closes open files', () => {
      return store.dispatch('closeFile', localFile).then(() => {
        expect(localFile.opened).toBe(false);
        expect(localFile.active).toBe(false);
        expect(store.state.openFiles.length).toBe(0);
      });
    });

    it('closes file even if file has changes', () => {
      store.state.changedFiles.push(localFile);

      return store
        .dispatch('closeFile', localFile)
        .then(nextTick)
        .then(() => {
          expect(store.state.openFiles.length).toBe(0);
          expect(store.state.changedFiles.length).toBe(1);
        });
    });

    it('switches to the next available file before closing the current one ', () => {
      const f = file('newOpenFile');

      store.state.openFiles.push(f);
      store.state.entries[f.path] = f;

      return store
        .dispatch('closeFile', localFile)
        .then(nextTick)
        .then(() => {
          expect(router.push).toHaveBeenCalledWith('/project/test/test/tree/main/-/newOpenFile/');
        });
    });

    it('removes file if it pending', () => {
      store.state.openFiles = [
        {
          ...localFile,
          pending: true,
        },
      ];

      return store.dispatch('closeFile', localFile).then(() => {
        expect(store.state.openFiles.length).toBe(0);
      });
    });
  });

  describe('setFileActive', () => {
    let localFile;
    let scrollToTabSpy;
    let oldScrollToTab;

    beforeEach(() => {
      scrollToTabSpy = jest.fn();
      oldScrollToTab = store._actions.scrollToTab; // eslint-disable-line
      store._actions.scrollToTab = [scrollToTabSpy]; // eslint-disable-line

      localFile = file('setThisActive');

      store.state.entries[localFile.path] = localFile;
    });

    afterEach(() => {
      store._actions.scrollToTab = oldScrollToTab; // eslint-disable-line
    });

    it('calls scrollToTab', () => {
      const dispatch = jest.fn();

      actions.setFileActive(
        { commit() {}, state: store.state, getters: store.getters, dispatch },
        localFile.path,
      );

      expect(dispatch).toHaveBeenCalledWith('scrollToTab');
    });

    it('commits SET_FILE_ACTIVE', () => {
      const commit = jest.fn();

      actions.setFileActive(
        { commit, state: store.state, getters: store.getters, dispatch() {} },
        localFile.path,
      );

      expect(commit).toHaveBeenCalledWith('SET_FILE_ACTIVE', {
        path: localFile.path,
        active: true,
      });
    });

    it('sets current active file to not active', () => {
      const f = file('newActive');
      store.state.entries[f.path] = f;
      localFile.active = true;
      store.state.openFiles.push(localFile);

      const commit = jest.fn();

      actions.setFileActive(
        { commit, state: store.state, getters: store.getters, dispatch() {} },
        f.path,
      );

      expect(commit).toHaveBeenCalledWith('SET_FILE_ACTIVE', {
        path: localFile.path,
        active: false,
      });
    });
  });

  describe('getFileData', () => {
    let localFile;

    beforeEach(() => {
      jest.spyOn(service, 'getFileData');

      localFile = file(`newCreate-${Math.random()}`);
      store.state.entries[localFile.path] = localFile;

      store.state.currentProjectId = 'test/test';
      store.state.currentBranchId = 'main';

      store.state.projects['test/test'] = {
        branches: {
          main: {
            commit: {
              id: '7297abc',
            },
          },
        },
      };
    });

    describe('call to service', () => {
      const callExpectation = (serviceCalled) => {
        store.dispatch('getFileData', { path: localFile.path });

        if (serviceCalled) {
          expect(service.getFileData).toHaveBeenCalled();
        } else {
          expect(service.getFileData).not.toHaveBeenCalled();
        }
      };

      beforeEach(() => {
        service.getFileData.mockImplementation(() => new Promise(() => {}));
      });

      it("isn't called if file.raw exists", () => {
        localFile.raw = 'raw data';

        callExpectation(false);
      });

      it("isn't called if file is a tempFile", () => {
        localFile.raw = '';
        localFile.tempFile = true;

        callExpectation(false);
      });

      it('is called if file is a tempFile but also renamed', () => {
        localFile.raw = '';
        localFile.tempFile = true;
        localFile.prevPath = 'old_path';

        callExpectation(true);
      });

      it('is called if tempFile but file was deleted and readded', () => {
        localFile.raw = '';
        localFile.tempFile = true;
        localFile.prevPath = 'old_path';

        store.state.stagedFiles = [{ ...localFile, deleted: true }];

        callExpectation(true);
      });
    });

    describe('success', () => {
      beforeEach(() => {
        mock.onGet(`${RELATIVE_URL_ROOT}/test/test/-/7297abc/${localFile.path}`).replyOnce(
          200,
          {
            raw_path: 'raw_path',
          },
          {
            'page-title': 'testing getFileData',
          },
        );
      });

      it('calls the service', () => {
        return store.dispatch('getFileData', { path: localFile.path }).then(() => {
          expect(service.getFileData).toHaveBeenCalledWith(
            `${RELATIVE_URL_ROOT}/test/test/-/7297abc/${localFile.path}`,
          );
        });
      });

      it('sets document title with the branchId', () => {
        return store.dispatch('getFileData', { path: localFile.path }).then(() => {
          expect(document.title).toBe(`${localFile.path} · main · test/test · GitLab`);
        });
      });

      it('sets the file as active', () => {
        return store.dispatch('getFileData', { path: localFile.path }).then(() => {
          expect(localFile.active).toBe(true);
        });
      });

      it('sets the file not as active if we pass makeFileActive false', () => {
        return store
          .dispatch('getFileData', { path: localFile.path, makeFileActive: false })
          .then(() => {
            expect(localFile.active).toBe(false);
          });
      });

      it('does not update the page title with the path of the file if makeFileActive is false', () => {
        document.title = 'dummy title';
        return store
          .dispatch('getFileData', { path: localFile.path, makeFileActive: false })
          .then(() => {
            expect(document.title).toBe(`dummy title`);
          });
      });

      it('adds the file to open files', () => {
        return store.dispatch('getFileData', { path: localFile.path }).then(() => {
          expect(store.state.openFiles.length).toBe(1);
          expect(store.state.openFiles[0].name).toBe(localFile.name);
        });
      });

      it('does not toggle loading if toggleLoading=false', () => {
        expect(localFile.loading).toBe(false);

        return store
          .dispatch('getFileData', {
            path: localFile.path,
            makeFileActive: false,
            toggleLoading: false,
          })
          .then(() => {
            expect(localFile.loading).toBe(true);
          });
      });
    });

    describe('Re-named success', () => {
      beforeEach(() => {
        localFile = file(`newCreate-${Math.random()}`);
        localFile.prevPath = 'old-dull-file';
        localFile.path = 'new-shiny-file';
        store.state.entries[localFile.path] = localFile;

        mock.onGet(`${RELATIVE_URL_ROOT}/test/test/-/7297abc/old-dull-file`).replyOnce(
          200,
          {
            raw_path: 'raw_path',
          },
          {
            'page-title': 'testing old-dull-file',
          },
        );
      });

      it('sets document title considering `prevPath` on a file', () => {
        return store.dispatch('getFileData', { path: localFile.path }).then(() => {
          expect(document.title).toBe(`new-shiny-file · main · test/test · GitLab`);
        });
      });
    });

    describe('error', () => {
      beforeEach(() => {
        mock.onGet(`${RELATIVE_URL_ROOT}/test/test/-/7297abc/${localFile.path}`).networkError();
      });

      it('dispatches error action', () => {
        const dispatch = jest.fn();

        return actions
          .getFileData(
            { state: store.state, commit() {}, dispatch, getters: store.getters },
            { path: localFile.path },
          )
          .then(() => {
            expect(dispatch).toHaveBeenCalledWith('setErrorMessage', {
              text: 'An error occurred while loading the file.',
              action: expect.any(Function),
              actionText: 'Please try again',
              actionPayload: {
                path: localFile.path,
                makeFileActive: true,
              },
            });
          });
      });
    });
  });

  describe('getRawFileData', () => {
    let tmpFile;

    beforeEach(() => {
      jest.spyOn(service, 'getRawFileData');

      tmpFile = { ...file('tmpFile'), rawPath: 'raw_path' };
      store.state.entries[tmpFile.path] = tmpFile;
    });

    describe('success', () => {
      beforeEach(() => {
        mock.onGet(/(.*)/).replyOnce(200, 'raw');
      });

      it('calls getRawFileData service method', () => {
        return store.dispatch('getRawFileData', { path: tmpFile.path }).then(() => {
          expect(service.getRawFileData).toHaveBeenCalledWith(tmpFile);
        });
      });

      it('updates file raw data', () => {
        return store.dispatch('getRawFileData', { path: tmpFile.path }).then(() => {
          expect(tmpFile.raw).toBe('raw');
        });
      });

      it('calls also getBaseRawFileData service method', () => {
        jest.spyOn(service, 'getBaseRawFileData').mockReturnValue(Promise.resolve('baseraw'));

        store.state.currentProjectId = 'gitlab-org/gitlab-ce';
        store.state.currentMergeRequestId = '1';
        store.state.projects = {
          'gitlab-org/gitlab-ce': {
            mergeRequests: {
              1: {
                baseCommitSha: 'SHA',
              },
            },
          },
        };

        tmpFile.mrChange = { new_file: false };

        return store.dispatch('getRawFileData', { path: tmpFile.path }).then(() => {
          expect(service.getBaseRawFileData).toHaveBeenCalledWith(
            tmpFile,
            'gitlab-org/gitlab-ce',
            'SHA',
          );
          expect(tmpFile.baseRaw).toBe('baseraw');
        });
      });

      describe('sets file loading to true', () => {
        let loadingWhenGettingRawData;
        let loadingWhenGettingBaseRawData;

        beforeEach(() => {
          loadingWhenGettingRawData = undefined;
          loadingWhenGettingBaseRawData = undefined;

          jest.spyOn(service, 'getRawFileData').mockImplementation((f) => {
            loadingWhenGettingRawData = f.loading;
            return Promise.resolve('raw');
          });
          jest.spyOn(service, 'getBaseRawFileData').mockImplementation((f) => {
            loadingWhenGettingBaseRawData = f.loading;
            return Promise.resolve('rawBase');
          });
        });

        it('when getting raw file data', async () => {
          expect(tmpFile.loading).toBe(false);

          await store.dispatch('getRawFileData', { path: tmpFile.path });

          expect(loadingWhenGettingRawData).toBe(true);
          expect(tmpFile.loading).toBe(false);
        });

        it('when getting base raw file data', async () => {
          tmpFile.mrChange = { new_file: false };

          expect(tmpFile.loading).toBe(false);

          await store.dispatch('getRawFileData', { path: tmpFile.path });

          expect(loadingWhenGettingBaseRawData).toBe(true);
          expect(tmpFile.loading).toBe(false);
        });

        it('when file was already loading', async () => {
          tmpFile.loading = true;

          await store.dispatch('getRawFileData', { path: tmpFile.path });

          expect(loadingWhenGettingRawData).toBe(true);
          expect(tmpFile.loading).toBe(false);
        });
      });
    });

    describe('return JSON', () => {
      beforeEach(() => {
        mock.onGet(/(.*)/).replyOnce(200, JSON.stringify({ test: '123' }));
      });

      it('does not parse returned JSON', () => {
        return store.dispatch('getRawFileData', { path: tmpFile.path }).then(() => {
          expect(tmpFile.raw).toEqual('{"test":"123"}');
        });
      });
    });

    describe('error', () => {
      beforeEach(() => {
        mock.onGet(/(.*)/).networkError();
      });

      it('dispatches error action', () => {
        const dispatch = jest.fn();

        return actions
          .getRawFileData(
            { state: store.state, commit() {}, dispatch, getters: store.getters },
            { path: tmpFile.path },
          )
          .catch(() => {
            expect(dispatch).toHaveBeenCalledWith('setErrorMessage', {
              text: 'An error occurred while loading the file content.',
              action: expect.any(Function),
              actionText: 'Please try again',
              actionPayload: {
                path: tmpFile.path,
              },
            });
          });
      });

      it('toggles loading off after error', async () => {
        await expect(store.dispatch('getRawFileData', { path: tmpFile.path })).rejects.toThrow();

        expect(tmpFile.loading).toBe(false);
      });
    });
  });

  describe('changeFileContent', () => {
    let tmpFile;
    let onFilesChange;

    beforeEach(() => {
      tmpFile = file('tmpFile');
      tmpFile.content = '\n';
      tmpFile.raw = '\n';
      store.state.entries[tmpFile.path] = tmpFile;
      onFilesChange = jest.fn();
      eventHub.$on('ide.files.change', onFilesChange);
    });

    it('updates file content', () => {
      const content = 'content\n';

      return store.dispatch('changeFileContent', { path: tmpFile.path, content }).then(() => {
        expect(tmpFile.content).toBe('content\n');
      });
    });

    it('does nothing if path does not exist', () => {
      const content = 'content\n';

      return store
        .dispatch('changeFileContent', { path: 'not/a/real_file.txt', content })
        .then(() => {
          expect(tmpFile.content).toBe('\n');
        });
    });

    it('adds file into stagedFiles array', () => {
      return store
        .dispatch('changeFileContent', {
          path: tmpFile.path,
          content: 'content',
        })
        .then(() => {
          expect(store.state.stagedFiles.length).toBe(1);
        });
    });

    it('adds file not more than once into stagedFiles array', () => {
      return store
        .dispatch('changeFileContent', {
          path: tmpFile.path,
          content: 'content',
        })
        .then(() =>
          store.dispatch('changeFileContent', {
            path: tmpFile.path,
            content: 'content 123',
          }),
        )
        .then(() => {
          expect(store.state.stagedFiles.length).toBe(1);
        });
    });

    it('removes file from changedFiles array if not changed', () => {
      return store
        .dispatch('changeFileContent', {
          path: tmpFile.path,
          content: 'content\n',
        })
        .then(() =>
          store.dispatch('changeFileContent', {
            path: tmpFile.path,
            content: '\n',
          }),
        )
        .then(() => {
          expect(store.state.changedFiles.length).toBe(0);
        });
    });

    it('triggers ide.files.change', async () => {
      expect(onFilesChange).not.toHaveBeenCalled();

      await store.dispatch('changeFileContent', {
        path: tmpFile.path,
        content: 'content\n',
      });

      expect(onFilesChange).toHaveBeenCalledWith(createTriggerUpdatePayload(tmpFile.path));
    });
  });

  describe('with changed file', () => {
    let tmpFile;

    beforeEach(() => {
      tmpFile = file('tempFile');
      tmpFile.content = 'testing';
      tmpFile.raw = ORIGINAL_CONTENT;

      store.state.changedFiles.push(tmpFile);
      store.state.entries[tmpFile.path] = tmpFile;
    });

    describe('restoreOriginalFile', () => {
      it('resets file content', () =>
        store.dispatch('restoreOriginalFile', tmpFile.path).then(() => {
          expect(tmpFile.content).toBe(ORIGINAL_CONTENT);
        }));

      it('closes temp file and deletes it', () => {
        tmpFile.tempFile = true;
        tmpFile.opened = true;
        tmpFile.parentPath = 'parentFile';
        store.state.entries.parentFile = file('parentFile');

        actions.restoreOriginalFile(store, tmpFile.path);

        expect(store.dispatch).toHaveBeenCalledWith('closeFile', tmpFile);
        expect(store.dispatch).toHaveBeenCalledWith('deleteEntry', tmpFile.path);
      });

      describe('with renamed file', () => {
        beforeEach(() => {
          Object.assign(tmpFile, {
            prevPath: 'parentPath/old_name',
            prevName: 'old_name',
            prevParentPath: 'parentPath',
          });

          store.state.entries.parentPath = file('parentPath');

          actions.restoreOriginalFile(store, tmpFile.path);
        });

        it('renames the file to its original name and closes it if it was open', () => {
          expect(store.dispatch).toHaveBeenCalledWith('closeFile', tmpFile);
          expect(store.dispatch).toHaveBeenCalledWith('renameEntry', {
            path: 'tempFile',
            name: 'old_name',
            parentPath: 'parentPath',
          });
        });

        it('resets file content', () => {
          expect(tmpFile.content).toBe(ORIGINAL_CONTENT);
        });
      });
    });

    describe('discardFileChanges', () => {
      beforeEach(() => {
        jest.spyOn(eventHub, '$on').mockImplementation(() => {});
        jest.spyOn(eventHub, '$emit').mockImplementation(() => {});
      });

      describe('with regular file', () => {
        beforeEach(() => {
          actions.discardFileChanges(store, tmpFile.path);
        });

        it('restores original file', () => {
          expect(store.dispatch).toHaveBeenCalledWith('restoreOriginalFile', tmpFile.path);
        });

        it('removes file from changedFiles array', () => {
          expect(store.state.changedFiles.length).toBe(0);
        });

        it('does not push a new route', () => {
          expect(router.push).not.toHaveBeenCalled();
        });

        it('emits eventHub event to dispose cached model', () => {
          actions.discardFileChanges(store, tmpFile.path);

          expect(eventHub.$emit).toHaveBeenCalledWith(
            `editor.update.model.new.content.${tmpFile.key}`,
            ORIGINAL_CONTENT,
          );
          expect(eventHub.$emit).toHaveBeenCalledWith(
            `editor.update.model.dispose.unstaged-${tmpFile.key}`,
            ORIGINAL_CONTENT,
          );
        });
      });

      describe('with active file', () => {
        beforeEach(() => {
          tmpFile.active = true;
          store.state.openFiles.push(tmpFile);

          actions.discardFileChanges(store, tmpFile.path);
        });

        it('pushes route for active file', () => {
          expect(router.push).toHaveBeenCalledWith('/project/test/test/tree/main/-/tempFile/');
        });
      });
    });
  });

  describe('stageChange', () => {
    it('calls STAGE_CHANGE with file path', () => {
      const f = { ...file('path'), content: 'old' };

      store.state.entries[f.path] = f;

      actions.stageChange(store, 'path');

      expect(store.commit).toHaveBeenCalledWith(
        types.STAGE_CHANGE,
        expect.objectContaining({ path: 'path' }),
      );
      expect(store.commit).toHaveBeenCalledWith(types.SET_LAST_COMMIT_MSG, '');
    });
  });

  describe('unstageChange', () => {
    it('calls UNSTAGE_CHANGE with file path', () => {
      const f = { ...file('path'), content: 'old' };

      store.state.entries[f.path] = f;
      store.state.stagedFiles.push({ f, content: 'new' });

      actions.unstageChange(store, 'path');

      expect(store.commit).toHaveBeenCalledWith(
        types.UNSTAGE_CHANGE,
        expect.objectContaining({ path: 'path' }),
      );
    });
  });

  describe('openPendingTab', () => {
    let f;

    beforeEach(() => {
      f = {
        ...file(),
        projectId: '123',
      };

      store.state.entries[f.path] = f;
    });

    it('makes file pending in openFiles', () => {
      return store.dispatch('openPendingTab', { file: f, keyPrefix: 'pending' }).then(() => {
        expect(store.state.openFiles[0].pending).toBe(true);
      });
    });

    it('returns true when opened', () => {
      return store.dispatch('openPendingTab', { file: f, keyPrefix: 'pending' }).then((added) => {
        expect(added).toBe(true);
      });
    });

    it('returns false when already opened', () => {
      store.state.openFiles.push({
        ...f,
        active: true,
        key: `pending-${f.key}`,
      });

      return store.dispatch('openPendingTab', { file: f, keyPrefix: 'pending' }).then((added) => {
        expect(added).toBe(false);
      });
    });

    it('pushes router URL when added', () => {
      return store.dispatch('openPendingTab', { file: f, keyPrefix: 'pending' }).then(() => {
        expect(router.push).toHaveBeenCalledWith('/project/test/test/tree/main/');
      });
    });
  });

  describe('removePendingTab', () => {
    let f;

    beforeEach(() => {
      jest.spyOn(eventHub, '$emit').mockImplementation(() => {});

      f = {
        ...file('pendingFile'),
        pending: true,
      };
    });

    it('removes pending file from open files', () => {
      store.state.openFiles.push(f);

      return store.dispatch('removePendingTab', f).then(() => {
        expect(store.state.openFiles.length).toBe(0);
      });
    });

    it('emits event to dispose model', () => {
      return store.dispatch('removePendingTab', f).then(() => {
        expect(eventHub.$emit).toHaveBeenCalledWith(`editor.update.model.dispose.${f.key}`);
      });
    });
  });

  describe('triggerFilesChange', () => {
    const { payload: renamePayload } = createTriggerRenameAction('test', '123');

    beforeEach(() => {
      jest.spyOn(eventHub, '$emit').mockImplementation(() => {});
    });

    it.each`
      args               | payload
      ${[]}              | ${{}}
      ${[renamePayload]} | ${renamePayload}
    `('emits event that files have changed (args=$args)', ({ args, payload }) => {
      return store.dispatch('triggerFilesChange', ...args).then(() => {
        expect(eventHub.$emit).toHaveBeenCalledWith('ide.files.change', payload);
      });
    });
  });
});
