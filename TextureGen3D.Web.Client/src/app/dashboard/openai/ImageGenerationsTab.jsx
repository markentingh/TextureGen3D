import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useSession } from '@/context/session';
import { OpenAI } from '@/api/admin/openai';
import Modal from '@/components/ui/modal';
import Carousel from '@/components/ui/carousel';
import BarChart from '@/components/ui/bar-chart';
import ProductImagePreview from '@/app/dashboard/project/components/ProductImagePreview';
import UserDetailsModal from '@/app/dashboard/users/UserDetailsModal';
import Icon from '@/components/ui/icon';

const TYPE_LABELS = ['Generation', 'Artwork', 'Product Image', 'Upscale'];

const formatDate = (value) => {
  if (!value) return 'N/A';
  const date = new Date(value);
  return date.toLocaleString('en-US', {
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: 'numeric', minute: '2-digit', second: '2-digit',
    hour12: true
  });
};

const formatCost = (cost) => {
  if (cost == null) return '$0.00';
  return `$${(cost / 100).toFixed(2)}`;
};

function getGeneratedImageUrl(gen) {
  if (!gen.projectId || !gen.id) return null;
  return `/api/projects/${gen.projectId}/generations/${gen.id}/image?thumb=true`;
}

function getGeneratedFullSizeUrl(gen) {
  if (!gen.projectId || !gen.id) return null;
  return `/api/projects/${gen.projectId}/generations/${gen.id}/image`;
}

function getReferenceImageUrl(ref, gen) {
  if (!ref || !ref.id) return null;
  if (ref.projectId) {
    return `/api/projects/${ref.projectId}/generations/${ref.id}/image?thumb=true`;
  }
  if (gen.projectId) {
    return `/api/projects/${gen.projectId}/generations/${ref.id}/image?thumb=true`;
  }
  return null;
}

function getReferenceFullSizeUrl(ref, gen) {
  if (!ref || !ref.id) return null;
  if (ref.projectId) {
    return `/api/projects/${ref.projectId}/generations/${ref.id}/image`;
  }
  if (gen.projectId) {
    return `/api/projects/${gen.projectId}/generations/${ref.id}/image`;
  }
  return null;
}

export default function ImageGenerationsTab() {
  const session = useSession();
  const { getImageGenerations, getDailyCosts } = OpenAI(session);
  const PAGE_SIZE = 25;

  const [generations, setGenerations] = useState([]);
  const [totalCount, setTotalCount] = useState(0);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [selectedGen, setSelectedGen] = useState(null);
  const [previewImages, setPreviewImages] = useState([]);
  const [previewIndex, setPreviewIndex] = useState(0);
  const [showPreview, setShowPreview] = useState(false);
  const [selectedUserId, setSelectedUserId] = useState(null);
  const [dailyCosts, setDailyCosts] = useState(null);
  const [costRange, setCostRange] = useState('30days');
  const scrollRef = useRef(null);
  const mountedRef = useRef(false);

  const fetchGenerations = useCallback(async (start, append = false) => {
    if (append) setLoadingMore(true); else setLoading(true);
    try {
      const response = await getImageGenerations(start, PAGE_SIZE);
      if (response.data.success) {
        const newItems = response.data.data.items || [];
        setTotalCount(response.data.data.totalCount || 0);
        if (append) {
          setGenerations(prev => [...prev, ...newItems]);
        } else {
          setGenerations(newItems);
        }
        setHasMore(start + PAGE_SIZE < (response.data.data.totalCount || 0));
      }
    } catch (error) {
      console.error('Error fetching image generations:', error);
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  }, [getImageGenerations]);

  useEffect(() => {
    if (mountedRef.current) return;
    mountedRef.current = true;
    fetchGenerations(0);
  }, []);

  useEffect(() => {
    getDailyCosts(costRange).then((response) => {
      if (response.data.success) {
        setDailyCosts(response.data.data || []);
      }
    }).catch((error) => console.error('Error fetching daily costs:', error));
  }, [costRange]);

  const handleScroll = useCallback((e) => {
    const el = e.target;
    if (el.scrollTop + el.clientHeight >= el.scrollHeight - 50 && hasMore && !loadingMore && !loading) {
      fetchGenerations(generations.length, true);
    }
  }, [hasMore, loadingMore, loading, generations.length, fetchGenerations]);

  const handleRowClick = (gen) => {
    setSelectedGen(gen);
  };

  const handleUserClick = useCallback((e, userId) => {
    e.preventDefault();
    e.stopPropagation();
    if (userId) setSelectedUserId(userId);
  }, []);

  const buildCarouselImages = (gen) => {
    const images = [];
    const generatedThumb = getGeneratedImageUrl(gen);
    if (generatedThumb) images.push(generatedThumb);

    try {
      const refs = JSON.parse(gen.inputImageJson || '[]');
      for (const ref of refs) {
        const refUrl = getReferenceImageUrl(ref, gen);
        if (refUrl) images.push(refUrl);
      }
    } catch { /* ignore */ }

    return images;
  };

  const buildFullSizeImages = (gen) => {
    const images = [];
    const generatedFull = getGeneratedFullSizeUrl(gen);
    if (generatedFull) images.push(generatedFull);

    try {
      const refs = JSON.parse(gen.inputImageJson || '[]');
      for (const ref of refs) {
        const refUrl = getReferenceFullSizeUrl(ref, gen);
        if (refUrl) images.push(refUrl);
      }
    } catch { /* ignore */ }

    return images;
  };

  const handleCarouselImageClick = (src, index) => {
    if (!selectedGen) return;
    const fullSizeImages = buildFullSizeImages(selectedGen);
    setPreviewImages(fullSizeImages);
    setPreviewIndex(index);
    setShowPreview(true);
  };

  return (
    <div>
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-3xl">Image Generations</h1>
        <select
          value={costRange}
          onChange={(e) => setCostRange(e.target.value)}
          className="px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300 focus:outline-none focus:ring-2 focus:ring-[#003cbf]"
        >
          <option value="30days">Past 30 Days</option>
          <option value="thismonth">This Month</option>
          <option value="lastmonth">Last Month</option>
          <option value="3months">Past 3 Months</option>
          <option value="12months">Past 12 Months</option>
          <option value="ytd">Year to Date</option>
        </select>
      </div>

      {dailyCosts !== null && (
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-4 mb-6">
          <div className="flex items-center justify-between mb-2">
            <div className="text-sm font-bold text-gray-500 dark:text-gray-400">
              Cost (USD) — {costRange === '30days' ? 'Past 30 Days' : costRange === 'thismonth' ? 'This Month' : costRange === 'lastmonth' ? 'Last Month' : costRange === '3months' ? 'Past 3 Months' : costRange === '12months' ? 'Past 12 Months' : 'Year to Date'}
            </div>
            <div className="flex items-center gap-4 text-xs text-gray-500 dark:text-gray-400">
              <div className="flex items-center gap-1.5">
                <span className="inline-block w-3 h-3 rounded-sm" style={{ backgroundColor: '#003cbf' }} />
                Generation
              </div>
              <div className="flex items-center gap-1.5">
                <span className="inline-block w-3 h-3 rounded-sm" style={{ backgroundColor: '#e91e63' }} />
                Upscale
              </div>
            </div>
          </div>
          <BarChart
            showXAxisLabels={costRange !== '3months' && costRange !== 'ytd'}
            data={(() => {
              const costMap = {};
              dailyCosts.forEach(d => { costMap[d.date] = d; });
              const today = new Date();
              const bars = [];

              if (costRange === '12months') {
                for (let i = 11; i >= 0; i--) {
                  const date = new Date(today.getFullYear(), today.getMonth() - i, 1);
                  const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-01`;
                  const entry = costMap[key];
                  const monthAbbr = date.toLocaleDateString('en-US', { month: 'short' });
                  const fullLabel = date.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
                  bars.push({
                    label: monthAbbr,
                    title: fullLabel,
                    value: entry?.totalCost || 0,
                    upscaleCost: entry?.upscaleCost || 0,
                    totalTokens: entry?.totalTokens || 0,
                    totalInputTextTokens: entry?.totalInputTextTokens || 0,
                    totalInputImageTokens: entry?.totalInputImageTokens || 0,
                    totalOutputTokens: entry?.totalOutputTokens || 0,
                    totalGenerations: entry?.totalGenerations || 0,
                  });
                }
              } else if (costRange === 'ytd') {
                const startYear = new Date(today.getFullYear(), 0, 1);
                for (let w = 0; w < 52; w++) {
                  const weekStart = new Date(startYear);
                  weekStart.setDate(weekStart.getDate() + w * 7);
                  const key = `${weekStart.getFullYear()}-${String(weekStart.getMonth() + 1).padStart(2, '0')}-${String(weekStart.getDate()).padStart(2, '0')}`;
                  const entry = costMap[key];
                  const weekEnd = new Date(weekStart);
                  weekEnd.setDate(weekEnd.getDate() + 6);
                  const fullLabel = `${weekStart.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} - ${weekEnd.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`;
                  bars.push({
                    label: '',
                    title: fullLabel,
                    value: entry?.totalCost || 0,
                    upscaleCost: entry?.upscaleCost || 0,
                    totalTokens: entry?.totalTokens || 0,
                    totalInputTextTokens: entry?.totalInputTextTokens || 0,
                    totalInputImageTokens: entry?.totalInputImageTokens || 0,
                    totalOutputTokens: entry?.totalOutputTokens || 0,
                    totalGenerations: entry?.totalGenerations || 0,
                  });
                }
              } else if (costRange === 'thismonth' || costRange === 'lastmonth') {
                const monthStart = costRange === 'thismonth'
                  ? new Date(today.getFullYear(), today.getMonth(), 1)
                  : new Date(today.getFullYear(), today.getMonth() - 1, 1);
                const numDays = new Date(monthStart.getFullYear(), monthStart.getMonth() + 1, 0).getDate();
                for (let i = 0; i < numDays; i++) {
                  const date = new Date(monthStart);
                  date.setDate(date.getDate() + i);
                  const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
                  const dd = String(date.getDate()).padStart(2, '0');
                  const fullLabel = date.toLocaleDateString('en-US', { month: 'long', day: 'numeric' });
                  const entry = costMap[key];
                  bars.push({
                    label: dd,
                    title: fullLabel,
                    value: entry?.totalCost || 0,
                    upscaleCost: entry?.upscaleCost || 0,
                    totalTokens: entry?.totalTokens || 0,
                    totalInputTextTokens: entry?.totalInputTextTokens || 0,
                    totalInputImageTokens: entry?.totalInputImageTokens || 0,
                    totalOutputTokens: entry?.totalOutputTokens || 0,
                    totalGenerations: entry?.totalGenerations || 0,
                  });
                }
              } else {
                const numDays = costRange === '3months' ? 90 : 30;
                for (let i = numDays - 1; i >= 0; i--) {
                  const date = new Date(today);
                  date.setDate(date.getDate() - i);
                  const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
                  const dd = String(date.getDate()).padStart(2, '0');
                  const fullLabel = date.toLocaleDateString('en-US', { month: 'long', day: 'numeric' });
                  const entry = costMap[key];
                  bars.push({
                    label: dd,
                    title: fullLabel,
                    value: entry?.totalCost || 0,
                    upscaleCost: entry?.upscaleCost || 0,
                    totalTokens: entry?.totalTokens || 0,
                    totalInputTextTokens: entry?.totalInputTextTokens || 0,
                    totalInputImageTokens: entry?.totalInputImageTokens || 0,
                    totalOutputTokens: entry?.totalOutputTokens || 0,
                    totalGenerations: entry?.totalGenerations || 0,
                  });
                }
              }
              return bars;
            })()}
            formatValue={(v) => `$${(v / 100).toFixed(2)}`}
            height={220}
          />
        </div>
      )}

      <div
        ref={scrollRef}
        onScroll={handleScroll}
        className="overflow-auto bg-white dark:bg-gray-800 rounded-lg shadow"
        style={{ maxHeight: 'calc(100vh - 250px)' }}
      >
        <table className="w-full text-left border-collapse">
          <thead className="bg-gray-100 dark:bg-gray-700 sticky top-0 z-10">
            <tr>
              <th className="px-4 py-3 whitespace-nowrap">Date</th>
              <th className="px-4 py-3 whitespace-nowrap">Type</th>
              <th className="px-4 py-3 whitespace-nowrap">Model</th>
              <th className="px-4 py-3 whitespace-nowrap">Text Input</th>
              <th className="px-4 py-3 whitespace-nowrap">Image Input</th>
              <th className="px-4 py-3 whitespace-nowrap">Output Tokens</th>
              <th className="px-4 py-3 whitespace-nowrap">Cost (USD)</th>
              <th className="px-4 py-3 whitespace-nowrap">Tokens Used</th>
              <th className="px-4 py-3 whitespace-nowrap">Resolution</th>
            </tr>
          </thead>
          <tbody>
            {generations.map((gen) => (
              <tr
                key={gen.id}
                onClick={() => handleRowClick(gen)}
                className="border-b border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700/50 cursor-pointer"
              >
                <td className="px-4 py-3 text-sm whitespace-nowrap">{gen.dateCreated ? new Date(gen.dateCreated).toLocaleString('en-US', { year: 'numeric', month: '2-digit', day: '2-digit', hour: 'numeric', minute: '2-digit', second: '2-digit', hour12: true }) : 'N/A'}</td>
                <td className="px-4 py-3 text-sm">{TYPE_LABELS[gen.type] || 'Unknown'}</td>
                <td className="px-4 py-3 text-sm">{gen.modelName || 'N/A'}</td>
                <td className="px-4 py-3 text-sm">{gen.inputTextTokens}</td>
                <td className="px-4 py-3 text-sm">{gen.inputImageTokens}</td>
                <td className="px-4 py-3 text-sm">{gen.outputTokens}</td>
                <td className="px-4 py-3 text-sm">{formatCost(gen.cost)}</td>
                <td className="px-4 py-3 text-sm">{gen.tokens}</td>
                <td className="px-4 py-3 text-sm">{gen.resolution || '-'}</td>
              </tr>
            ))}
            {generations.length === 0 && !loading && (
              <tr>
                <td colSpan="9" className="text-center py-8 text-gray-600 dark:text-gray-400">
                  No image generations found.
                </td>
              </tr>
            )}
            {loading && generations.length === 0 && (
              <tr>
                <td colSpan="9" className="text-center py-8 text-gray-600 dark:text-gray-400">
                  <Icon name="progress_activity" spin className="w-5 h-5 inline mr-2" />
                  Loading...
                </td>
              </tr>
            )}
          </tbody>
        </table>
        {loadingMore && (
          <div className="text-center py-4 text-gray-600 dark:text-gray-400">
            <Icon name="progress_activity" spin className="w-5 h-5 inline mr-2" />
            Loading more...
          </div>
        )}
      </div>

      {selectedGen && (
        <Modal title="Image Generation Details" onClose={() => setSelectedGen(null)} className="w-[800px] max-w-full">
          <ImageGenerationDetail
            gen={selectedGen}
            onCarouselImageClick={handleCarouselImageClick}
            onUserClick={handleUserClick}
          />
        </Modal>
      )}

      {showPreview && previewImages.length > 0 && (
        <ProductImagePreview
          show={showPreview}
          images={previewImages}
          alt="Image Preview"
          defaultIndex={previewIndex}
          onClose={() => setShowPreview(false)}
        />
      )}

      {selectedUserId && (
        <UserDetailsModal userId={selectedUserId} onClose={() => setSelectedUserId(null)} />
      )}
    </div>
  );
}

function ImageGenerationDetail({ gen, onCarouselImageClick, onUserClick }) {
  const [promptExpanded, setPromptExpanded] = useState(false);
  const carouselImages = React.useMemo(() => {
    const images = [];
    const generatedThumb = getGeneratedImageUrl(gen);
    if (generatedThumb) images.push(generatedThumb);
    try {
      const refs = JSON.parse(gen.inputImageJson || '[]');
      for (const ref of refs) {
        const refUrl = getReferenceImageUrl(ref, gen);
        if (refUrl) images.push(refUrl);
      }
    } catch { /* ignore */ }
    return images;
  }, [gen]);

  return (
    <div className="space-y-4">
      <div className="flex gap-8">
        <div>
          <div className="text-xs font-bold text-gray-500 dark:text-gray-400 mb-0.5">User</div>
          <div className="text-base"><a href="#" onClick={(e) => onUserClick(e, gen.appUserId)} className="text-primary-600 hover:underline">{gen.userEmail || 'N/A'}</a></div>
        </div>
        <div>
          <div className="text-xs font-bold text-gray-500 dark:text-gray-400 mb-0.5">Project</div>
          <div className="text-base"><a href={`/dashboard/project/${gen.projectId}`} target="_blank" rel="noopener noreferrer" className="text-primary-600 hover:underline">{gen.projectTitle || 'N/A'}</a></div>
        </div>
      </div>

      <div className="flex gap-8">
        <div>
          <div className="text-xs font-bold text-gray-500 dark:text-gray-400 mb-0.5">Type</div>
          <div className="text-base">{TYPE_LABELS[gen.type] || 'Unknown'}</div>
        </div>
        <div>
          <div className="text-xs font-bold text-gray-500 dark:text-gray-400 mb-0.5">Resolution</div>
          <div className="text-base">{gen.resolution || '-'}</div>
        </div>
        <div>
          <div className="text-xs font-bold text-gray-500 dark:text-gray-400 mb-0.5">Created</div>
          <div className="text-base">{formatDate(gen.dateCreated)}</div>
        </div>
      </div>

      <div className="flex gap-8">
        <div>
          <div className="text-xs font-bold text-gray-500 dark:text-gray-400 mb-0.5">Input Text</div>
          <div className="text-base">{gen.inputTextTokens}</div>
        </div>
        <div>
          <div className="text-xs font-bold text-gray-500 dark:text-gray-400 mb-0.5">Input Image</div>
          <div className="text-base">{gen.inputImageTokens}</div>
        </div>
        <div>
          <div className="text-xs font-bold text-gray-500 dark:text-gray-400 mb-0.5">Output Tokens</div>
          <div className="text-base">{gen.outputTokens}</div>
        </div>
        <div>
          <div className="text-xs font-bold text-gray-500 dark:text-gray-400 mb-0.5">Platform Tokens</div>
          <div className="text-base">{gen.tokens}</div>
        </div>
        <div>
          <div className="text-xs font-bold text-gray-500 dark:text-gray-400 mb-0.5">Cost (USD)</div>
          <div className="text-base">{formatCost(gen.cost)}</div>
        </div>
      </div>

      {carouselImages.length > 0 && (
        <div>
          <div className="text-xs font-bold text-gray-500 dark:text-gray-400 mb-2">Images</div>
          <Carousel
            images={carouselImages}
            alt="Generated image"
            onImageClick={onCarouselImageClick}
            imageWidth="350px"
            imageHeight="350px"
            imageClassName="rounded-lg"
          />
        </div>
      )}

      {gen.prompt && (
        <div>
          <div className="text-xs font-bold text-gray-500 dark:text-gray-400 mb-1">Prompt</div>
          <div className={`text-base text-gray-700 dark:text-gray-300 whitespace-pre-wrap ${!promptExpanded ? 'line-clamp-5' : ''}`}>
            {gen.prompt}
          </div>
          {gen.prompt.length > 200 && (
            <button
              onClick={() => setPromptExpanded(!promptExpanded)}
              className="text-primary-600 text-sm hover:underline mt-1"
            >
              {promptExpanded ? 'Show Less...' : 'Read More...'}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
