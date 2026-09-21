import React from 'react';
import { useProject } from '@/context/project';
import { ProjectCameraAngles } from '@/api/user/projectCameraAngles';
import { ProjectMeshReferences } from '@/api/user/projectMeshReferences';
import { ProjectReferences } from '@/api/user/projectReferences';
import ReferenceCell from './ReferenceCell';
import ReferenceModal from './ReferenceModal';
import ProjectReferencesModal from './ProjectReferencesModal';
import { useModal } from '@/context/modal';

/**
 * ReferenceImagesSection — the "Image References" grid shared by
 * GenerateImagesPanel and InpaintPanel. In angleMode it shows the selected
 * camera angle's single reference; otherwise it shows the mesh's reference
 * list with active checkboxes.
 */
export default function ReferenceImagesSection({ angleMode = false, maxRefs = 0 }) {
  const {
    id,
    token,
    selectedMesh,
    meshDbIds,
    meshRefView,
    setMeshRefView,
    angleRefView,
    setAngleRefView,
    setMeshReferences,
    projectRefs,
    setProjectRefs,
    cameraAngles,
    setCameraAngles,
    selectedAngleId,
    refImageModels,
    refreshMeshRefView,
  } = useProject();
  const { showModal, hideModal } = useModal();

  const handleRefToggleActive = async (ref) => {
    if (!ref.meshRefId) return;
    const newActive = !ref.active;
    setMeshRefView((prev) =>
      prev.map((r) => (r.id === ref.id ? { ...r, active: newActive } : r))
    );
    try {
      const meshRefApi = ProjectMeshReferences({ token });
      await meshRefApi.updateActive(id, ref.meshRefId, newActive);
    } catch (err) {
      setMeshRefView((prev) =>
        prev.map((r) => (r.id === ref.id ? { ...r, active: !newActive } : r))
      );
      console.error('Failed to update reference active state:', err);
    }
  };

  const handleRefDelete = async (ref) => {
    if (!ref.meshRefId) return;
    try {
      const meshRefApi = ProjectMeshReferences({ token });
      await meshRefApi.delete(id, ref.meshRefId);
      const meshDbId = selectedMesh ? meshDbIds[selectedMesh.key] : null;
      if (meshDbId) {
        setMeshReferences((prev) => ({
          ...prev,
          [meshDbId]: (prev[meshDbId] || []).filter(
            (mr) => mr.projectReferenceId !== ref.id
          ),
        }));
      }
      setMeshRefView((prev) => prev.filter((r) => r.id !== ref.id));
    } catch (err) {
      console.error('Failed to remove reference from mesh:', err);
    }
  };

  const handleModalMeshRefChanged = async () => {
    if (!selectedMesh) return;
    const meshDbId = meshDbIds[selectedMesh.key];
    if (!meshDbId) return;
    try {
      const meshRefApi = ProjectMeshReferences({ token });
      const res = await meshRefApi.getByMesh(id, meshDbId);
      if (res.data?.success) {
        setMeshReferences((prev) => ({ ...prev, [meshDbId]: res.data.data || [] }));
      }
    } catch {
      /* ignore */
    }
  };

  const handleModalProjectRefsChanged = async () => {
    try {
      const refApi = ProjectReferences({ token });
      const res = await refApi.getByProject(id);
      if (res.data?.success) {
        setProjectRefs(res.data.data || []);
      }
    } catch {
      /* ignore */
    }
  };

  // Opens the project-references picker. In angle mode the selection is stored
  // on the camera angle; in mesh mode the selected project reference replaces
  // `replaceRef` (Change Image) or — when maxRefs caps the list at 1 — whatever
  // reference the mesh currently has.
  const openProjectRefsModal = ({ replaceRef = null } = {}) => {
    const meshDbId = selectedMesh ? meshDbIds[selectedMesh.key] : null;
    const angleRefMode = angleMode && !!selectedAngleId;
    const singleSelect = angleRefMode || !!replaceRef || maxRefs === 1;
    showModal({
      title: 'Project References',
      className: 'max-w-[1200px]',
      onClose: hideModal,
      body: (
        <ProjectReferencesModal
          projectId={id}
          token={token}
          meshId={meshDbId}
          cameraAngleMode={angleRefMode}
          singleSelect={singleSelect}
          selectedRefId={
            angleRefMode
              ? (cameraAngles.find((a) => a.id === selectedAngleId)?.projectReferenceId || null)
              : (replaceRef?.id ?? (maxRefs === 1 ? meshRefView[0]?.id ?? null : null))
          }
          onSelectReference={async (refId) => {
            try {
              if (angleRefMode) {
                const anglesApi = ProjectCameraAngles({ token });
                await anglesApi.updateReference(id, selectedAngleId, refId);
                setCameraAngles((prev) => prev.map((a) => a.id === selectedAngleId ? { ...a, projectReferenceId: refId } : a));
                const ref = projectRefs.find((r) => r.id === refId);
                setAngleRefView(ref ? [{ ...ref, active: true }] : []);
              } else {
                if (!meshDbId) return;
                const meshRefApi = ProjectMeshReferences({ token });
                const toRemove = replaceRef ? [replaceRef] : (maxRefs === 1 ? meshRefView : []);
                const keepActive = replaceRef ? replaceRef.active : true;
                for (const r of toRemove) {
                  if (r.meshRefId && r.id !== refId) {
                    await meshRefApi.delete(id, r.meshRefId);
                  }
                }
                const addRes = await meshRefApi.add(id, meshDbId, refId);
                const createdId = addRes.data?.data?.id;
                if (createdId && !keepActive) {
                  await meshRefApi.updateActive(id, createdId, false);
                }
                await handleModalMeshRefChanged();
                refreshMeshRefView();
              }
              hideModal();
            } catch (err) {
              console.error('Failed to select reference:', err);
            }
          }}
          onClose={hideModal}
          onAdded={handleModalMeshRefChanged}
          onDeleted={handleModalMeshRefChanged}
          onProjectReferencesChanged={async () => {
            await handleModalProjectRefsChanged();
            handleModalMeshRefChanged();
          }}
        />
      ),
    });
  };

  const openRefModal = ({ reference, mode, isAngleRef, angleId }) => {
    showModal({
      title: mode === 'edit' ? 'Edit Reference' : 'New Reference',
      className: 'max-w-[1200px]',
      onClose: hideModal,
      body: (
        <ReferenceModal
          reference={reference}
          projectId={id}
          token={token}
          imageModels={refImageModels}
          mode={mode}
          onClose={hideModal}
          onSaved={async (savedRef) => {
            await handleModalProjectRefsChanged();
            refreshMeshRefView();
            if (isAngleRef && angleId && savedRef?.id) {
              try {
                const anglesApi = ProjectCameraAngles({ token });
                await anglesApi.updateReference(id, angleId, savedRef.id);
                setCameraAngles((prev) => prev.map((a) => a.id === angleId ? { ...a, projectReferenceId: savedRef.id } : a));
                setAngleRefView([{ ...savedRef, active: true }]);
              } catch (err) {
                console.error('Failed to update camera angle reference:', err);
              }
            }
          }}
        />
      ),
    });
  };

  return (
    <div>
      <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">Image References</label>
      <div className={`grid grid-cols-3 gap-x-1 gap-y-3 p-1 rounded-lg w-fit transition`}>
        {(angleMode ? angleRefView : meshRefView).map((ref) => (
          <ReferenceCell
            key={ref.id}
            ref_={ref}
            projectId={id}
            token={token}
            showCheckbox={!angleMode}
            onPreview={(r) => showModal({
              title: 'Reference Preview',
              className: 'max-w-[90vw] max-h-[90vh]',
              onClose: hideModal,
              body: (
                <div className="flex items-center justify-center" onClick={hideModal}>
                  <img
                    src={ProjectReferences({ token }).imageUrl(id, r.id)}
                    alt={r.filename || 'Reference'}
                    className="max-w-[85vw] max-h-[80vh] object-contain rounded-lg"
                    onClick={(e) => e.stopPropagation()}
                  />
                </div>
              ),
            })}
            onToggleActive={() => handleRefToggleActive(ref)}
            onDelete={() => {
              if (angleMode && selectedAngleId) {
                (async () => {
                  try {
                    const anglesApi = ProjectCameraAngles({ token });
                    await anglesApi.updateReference(id, selectedAngleId, null);
                    setCameraAngles((prev) => prev.map((a) => a.id === selectedAngleId ? { ...a, projectReferenceId: null } : a));
                    setAngleRefView([]);
                  } catch (err) {
                    console.error('Failed to remove reference from camera angle:', err);
                  }
                })();
              } else {
                handleRefDelete(ref);
              }
            }}
            onNewImage={() => openRefModal({ reference: ref, mode: 'new', isAngleRef: angleMode, angleId: selectedAngleId })}
            onEditImage={() => openRefModal({ reference: ref, mode: 'edit' })}
            onChangeImage={() => openProjectRefsModal({ replaceRef: ref })}
          />
        ))}
        {(!angleMode || angleRefView.length === 0) && (!maxRefs || (angleMode ? angleRefView : meshRefView).length < maxRefs) && (
          <div
            onClick={() => openProjectRefsModal()}
            className={`relative border-2 border-dashed rounded-lg flex flex-col items-center justify-center cursor-pointer transition border-gray-300 dark:border-gray-600 hover:border-purple-400 dark:hover:border-purple-500`}
            style={{ width: 100, height: 80 }}
          >
            <>
              <svg className="w-5 h-5 text-gray-400 dark:text-gray-500 mb-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
              </svg>
              <span className="text-[8px] text-gray-400 dark:text-gray-500 text-center leading-tight px-1">Add</span>
            </>
          </div>
        )}
      </div>
    </div>
  );
}
