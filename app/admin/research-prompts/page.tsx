'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { DndContext, closestCenter, KeyboardSensor, PointerSensor, useSensor, useSensors, DragEndEvent } from '@dnd-kit/core';
import { arrayMove, SortableContext, sortableKeyboardCoordinates, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { ResearchPrompt, Phase4Prompt } from '@/types/research-prompts';
import AdminNav from '@/components/AdminNav';
import { FullPageLoading } from '@/components/ui/loading-spinner';
import { getVariablesForPrompt, getMissingRequiredVariables, type VariableSpec } from '@/lib/prompt-variables';

// Union type for both prompt types
type AnyPrompt = ResearchPrompt | Phase4Prompt;

const PHASE_NAMES: Record<number | string, string> = {
  1: 'Competitive Intelligence',
  2: 'SEO & Content Strategy',
  3: 'Conversion Optimization',
  4: 'Claude Synthesis (4.1–4.5)',
  5: 'Claude Summaries (Phase 1–3)',
  10: 'Enhanced Pipeline (10.1–10.8)',
  build: 'Site Builder Prompt',
};

export default function ResearchPromptsPage() {
  const router = useRouter();
  const [user, setUser] = useState<any>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [loading, setLoading] = useState(true);
  const [activePhase, setActivePhase] = useState<1 | 2 | 3 | 4 | 5 | 10 | 'build'>(1);
  const [prompts, setPrompts] = useState<AnyPrompt[]>([]);
  const [editingPrompt, setEditingPrompt] = useState<AnyPrompt | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [testingPrompt, setTestingPrompt] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [deletingPrompt, setDeletingPrompt] = useState<{ id: string; name: string } | null>(null);
  const [claudeSummaries, setClaudeSummaries] = useState<{ phase1: string; phase2: string; phase3: string } | null>(null);
  const [buildSitePrompt, setBuildSitePrompt] = useState<string | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  useEffect(() => {
    checkAdminAccess();
  }, []);

  useEffect(() => {
    if (isAdmin) {
      fetchPrompts(activePhase);
    }
  }, [activePhase, isAdmin]);

  async function checkAdminAccess() {
    try {
      const response = await fetch('/api/admin/check-access');
      const data = (await response.json()) as { isAdmin?: boolean; user?: { id: string; email?: string } };

      if (!response.ok || !data.isAdmin) {
        router.push('/dashboard');
        return;
      }

      setUser(data.user ?? null);
      setIsAdmin(true);
    } catch (error) {
      console.error('Error checking admin access:', error);
      router.push('/dashboard');
    } finally {
      setLoading(false);
    }
  }

  async function fetchPrompts(phase: number | 'build') {
    try {
      if (phase === 'build') {
        const response = await fetch('/api/admin/build-site-prompt');
        const data = (await response.json()) as { prompt?: string; error?: string };
        if (response.ok) {
          setBuildSitePrompt(data.prompt ?? '');
        } else {
          showMessage('error', data.error || 'Failed to fetch build site prompt');
        }
        return;
      }
      if (phase === 5) {
        const response = await fetch('/api/admin/claude-summary-prompts');
        const data = (await response.json()) as { phase1?: string; phase2?: string; phase3?: string; error?: string };
        if (response.ok) {
          setClaudeSummaries({ phase1: data.phase1 ?? '', phase2: data.phase2 ?? '', phase3: data.phase3 ?? '' });
        } else {
          showMessage('error', data.error || 'Failed to fetch Claude summary prompts');
        }
        return;
      }
      // Phase 4 and Phase 10 use the phase4_prompts table
      if (phase === 4 || phase === 10) {
        const response = await fetch(`/api/admin/phase4-prompts${phase === 10 ? '?tier=enhanced' : ''}`);
        const data = (await response.json()) as { prompts?: AnyPrompt[]; error?: string };

        if (response.ok) {
          // Filter to show only 4.x or 10.x depending on the active phase
          const filtered = (data.prompts || []).filter((p: any) => {
            const sub = p.subphase || '';
            return phase === 10 ? sub.startsWith('10.') : !sub.startsWith('10.');
          });
          setPrompts(filtered);
        } else {
          showMessage('error', data.error || `Failed to fetch Phase ${phase} prompts`);
        }
      } else {
        const response = await fetch(`/api/admin/research-prompts?phase=${phase}`);
        const data = (await response.json()) as { prompts?: AnyPrompt[]; error?: string };

        if (response.ok) {
          setPrompts(data.prompts || []);
        } else {
          showMessage('error', data.error || 'Failed to fetch prompts');
        }
      }
    } catch (error) {
      console.error('Error fetching prompts:', error);
      showMessage('error', 'Failed to fetch prompts');
    }
  }

  async function createPrompt(data: any) {
    setSaving(true);
    try {
      console.log('[CreatePrompt] Creating prompt:', data, 'Phase:', activePhase);
      
      // Phase 4 uses a different API endpoint
      let response;
      if (activePhase === 4 || activePhase === 10) {
        response = await fetch('/api/admin/phase4-prompts', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ 
            subphase: data.subphase || '4.1', // Phase 4 has subphases
            name: data.name,
            prompt_template: data.prompt_template,
            internal_notes: data.internal_notes || null,
            order_index: 0
          })
        });
      } else {
        response = await fetch('/api/admin/research-prompts', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...data, phase: activePhase })
        });
      }

      console.log('[CreatePrompt] Response status:', response.status);
      const result = (await response.json()) as { error?: string };
      console.log('[CreatePrompt] Response data:', result);

      if (response.ok) {
        showMessage('success', 'Prompt created successfully');
        fetchPrompts(activePhase);
        setIsCreating(false);
        setEditingPrompt(null);
      } else {
        console.error('[CreatePrompt] Error:', result);
        showMessage('error', result.error || 'Failed to create prompt');
      }
    } catch (error) {
      console.error('[CreatePrompt] Exception:', error);
      showMessage('error', `Failed to create prompt: ${error}`);
    } finally {
      setSaving(false);
    }
  }

  async function updatePrompt(id: string, data: any) {
    setSaving(true);
    try {
      console.log('[UpdatePrompt] Updating prompt:', id, data, 'Phase:', activePhase);
      
      // Phase 4 uses a different API endpoint and structure
      let response;
      if (activePhase === 4 || activePhase === 10) {
        const phase4Prompt = editingPrompt as Phase4Prompt & { _isDefault?: boolean } | undefined;
        const isDefaultPrompt = phase4Prompt && (id.startsWith('default-') || phase4Prompt._isDefault);
        if (isDefaultPrompt) {
          const subphase = (phase4Prompt?.subphase ?? id.replace('default-', '')) || '4.1';
          response = await fetch('/api/admin/phase4-prompts', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ subphase, name: data.name, prompt_template: data.prompt_template, internal_notes: data.internal_notes, status: data.status })
          });
        } else {
          response = await fetch('/api/admin/phase4-prompts', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id, ...data })
          });
        }
      } else {
        response = await fetch(`/api/admin/research-prompts/${id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(data)
        });
      }

      console.log('[UpdatePrompt] Response status:', response.status);
      const result = (await response.json()) as { error?: string };
      console.log('[UpdatePrompt] Response data:', result);

      if (response.ok) {
        showMessage('success', 'Prompt updated successfully');
        fetchPrompts(activePhase);
        setEditingPrompt(null);
      } else {
        console.error('[UpdatePrompt] Error:', result);
        showMessage('error', result.error || 'Failed to update prompt');
      }
    } catch (error) {
      console.error('[UpdatePrompt] Exception:', error);
      showMessage('error', `Failed to update prompt: ${error}`);
    } finally {
      setSaving(false);
    }
  }

  async function saveBuildSitePrompt(prompt: string) {
    setSaving(true);
    try {
      const response = await fetch('/api/admin/build-site-prompt', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt }),
      });
      const data = (await response.json()) as { error?: string };
      if (response.ok) {
        showMessage('success', 'Build site prompt saved');
        setBuildSitePrompt(prompt);
      } else {
        showMessage('error', data.error || 'Failed to save');
      }
    } catch (e) {
      showMessage('error', 'Failed to save build site prompt');
    } finally {
      setSaving(false);
    }
  }

  async function saveClaudeSummaries(payload: { phase1: string; phase2: string; phase3: string }) {
    setSaving(true);
    try {
      const response = await fetch('/api/admin/claude-summary-prompts', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = (await response.json()) as { error?: string };
      if (response.ok) {
        showMessage('success', 'Claude summary prompts saved');
        setClaudeSummaries(payload);
      } else {
        showMessage('error', data.error || 'Failed to save');
      }
    } catch (e) {
      showMessage('error', 'Failed to save Claude summary prompts');
    } finally {
      setSaving(false);
    }
  }

  async function confirmDelete(id: string, name: string) {
    setDeletingPrompt({ id, name });
  }

  async function deletePrompt() {
    if (!deletingPrompt) return;

    try {
      // Phase 4 uses a different API endpoint
      let response;
      if (activePhase === 4 || activePhase === 10) {
        response = await fetch(`/api/admin/phase4-prompts?id=${deletingPrompt.id}`, {
          method: 'DELETE'
        });
      } else {
        response = await fetch(`/api/admin/research-prompts/${deletingPrompt.id}`, {
          method: 'DELETE'
        });
      }

      if (response.ok) {
        showMessage('success', 'Prompt deleted successfully');
        fetchPrompts(activePhase);
        setDeletingPrompt(null);
      } else {
        const data = (await response.json()) as { error?: string };
        showMessage('error', data.error || 'Failed to delete prompt');
        setDeletingPrompt(null);
      }
    } catch (error) {
      showMessage('error', 'Failed to delete prompt');
      setDeletingPrompt(null);
    }
  }

  async function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;

    if (over && active.id !== over.id) {
      const oldIndex = prompts.findIndex(p => p.id === active.id);
      const newIndex = prompts.findIndex(p => p.id === over.id);

      const newPrompts = arrayMove(prompts, oldIndex, newIndex);
      setPrompts(newPrompts);

      // Save new order to backend
      try {
        const response = await fetch('/api/admin/research-prompts/reorder', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            phase: activePhase,
            promptIds: newPrompts.map(p => p.id)
          })
        });

        if (response.ok) {
          showMessage('success', 'Prompt order updated');
        } else {
          showMessage('error', 'Failed to save new order');
          fetchPrompts(activePhase); // Revert
        }
      } catch (error) {
        console.error('Error saving order:', error);
        showMessage('error', 'Failed to save new order');
        fetchPrompts(activePhase); // Revert
      }
    }
  }

  async function exportPrompts() {
    try {
      const response = await fetch(`/api/admin/research-prompts/import-export?phase=${activePhase}`);
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `research-prompts-phase${activePhase}.json`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
      showMessage('success', 'Prompts exported successfully');
    } catch (error) {
      showMessage('error', 'Failed to export prompts');
    }
  }

  async function importPrompts(file: File) {
    try {
      const text = await file.text();
      const prompts = JSON.parse(text);

      const response = await fetch('/api/admin/research-prompts/import-export', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompts, mode: 'append' })
      });

      const result = (await response.json()) as { imported?: number; skipped?: number; error?: string };

      if (response.ok) {
        showMessage('success', `Imported ${result.imported} prompts, skipped ${result.skipped}`);
        fetchPrompts(activePhase);
      } else {
        showMessage('error', result.error || 'Failed to import prompts');
      }
    } catch (error) {
      showMessage('error', 'Failed to import prompts');
    }
  }

  function showMessage(type: 'success' | 'error', text: string) {
    setMessage({ type, text });
    setTimeout(() => setMessage(null), 5000);
  }

  if (loading) {
    return (
      <FullPageLoading message="Loading…" variant="light" />
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 py-8">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-gray-900">Research Prompt Management</h1>
          <p className="mt-2 text-black">
            Manage dynamic research prompts for each phase. Add, edit, reorder, and test prompts without code changes.
          </p>
          <div className="mt-4">
            <AdminNav />
          </div>
        </div>

        {/* Message Banner */}
        {message && (
          <div className={`mb-6 p-4 rounded-lg ${message.type === 'success' ? 'bg-green-50 text-green-800 border border-green-200' : 'bg-red-50 text-red-800 border border-red-200'}`}>
            {message.text}
          </div>
        )}

        {/* Tavily Configuration Notice */}
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 mb-6">
          <div className="flex items-start">
            <svg className="w-5 h-5 text-blue-600 mt-0.5 mr-3 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd" />
            </svg>
            <div>
              <h3 className="text-sm font-semibold text-blue-900 mb-1">Tavily Search Parameters</h3>
              <p className="text-sm text-blue-800">
                Each phase uses its own Tavily configuration (search depth, max results, etc.). Configure these settings in the{' '}
                <button
                  onClick={() => router.push('/admin/tavily-config')}
                  className="font-semibold underline hover:text-blue-900"
                >
                  Tavily Config page →
                </button>
              </p>
            </div>
          </div>
        </div>

        {/* Phase Tabs */}
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 mb-6">
          <div className="border-b border-gray-200">
            <nav className="flex -mb-px">
              {([1, 2, 3, 4, 5, 10] as const).map((phase) => (
                <button
                  key={phase}
                  onClick={() => setActivePhase(phase)}
                  className={`px-6 py-4 text-sm font-medium border-b-2 ${
                    activePhase === phase
                      ? 'border-blue-600 text-blue-600'
                      : 'border-transparent text-gray-900 hover:text-blue-600 hover:border-gray-300'
                  }`}
                >
                  {phase === 5 ? 'Summaries' : phase === 10 ? 'Enhanced' : `Phase ${phase}`}: {PHASE_NAMES[phase]}
                  {activePhase === phase && phase !== 5 && (
                    <span className="ml-2 text-xs text-gray-900">
                      ({prompts.length} prompts)
                    </span>
                  )}
                  {activePhase === phase && phase === 5 && (
                    <span className="ml-2 text-xs text-gray-900">(3 prompts)</span>
                  )}
                </button>
              ))}
              <button
                onClick={() => setActivePhase('build')}
                className={`px-6 py-4 text-sm font-medium border-b-2 ${
                  activePhase === 'build'
                    ? 'border-green-600 text-green-600'
                    : 'border-transparent text-gray-900 hover:text-green-600 hover:border-gray-300'
                }`}
              >
                Build: {PHASE_NAMES['build']}
              </button>
            </nav>
          </div>

          {/* Phase 4 Info Banner */}
          {activePhase === 4 && (
            <div className="p-4 bg-purple-50 border-b border-purple-200">
              <h3 className="text-sm font-semibold text-purple-900 mb-1">
                Phase 4: Claude Synthesis (4.1–4.5)
              </h3>
              <p className="text-sm text-purple-800 mb-2">
                These five prompts are used for the <strong>basic tier</strong> pipeline. After 4.5, the worker uses the page list from 4.4 to generate per-page Cursor IDE prompts dynamically.
              </p>
              <ol className="text-sm text-purple-800 ml-4 list-decimal space-y-1">
                <li><strong>4.1 Competitive Intelligence:</strong> Synthesizes Phase 1 research</li>
                <li><strong>4.2 SEO Strategy:</strong> Synthesizes Phase 2 research (+ DataForSEO when available)</li>
                <li><strong>4.3 CRO Guide:</strong> Synthesizes Phase 3 research</li>
                <li><strong>4.4 Wireframe/Page List:</strong> Generates list of pages needed for the website</li>
                <li><strong>4.5 UI Design System:</strong> Creates color palette and design rules</li>
              </ol>
            </div>
          )}

          {/* Phase 10 Info Banner */}
          {activePhase === 10 && (
            <div className="p-4 bg-indigo-50 border-b border-indigo-200">
              <h3 className="text-sm font-semibold text-indigo-900 mb-1">
                Enhanced Pipeline (10.1–10.8) — Opus 4.6
              </h3>
              <p className="text-sm text-indigo-800 mb-2">
                The enhanced pipeline runs for <strong>intermediate and advanced tier</strong> sessions with full DataForSEO data. Each sub-phase chains its output into the next. Uses <code>{`{{VARIABLE}}`}</code> template syntax — see internal notes for available variables per prompt.
              </p>
              <ol className="text-sm text-indigo-800 ml-4 list-decimal space-y-1">
                <li><strong>10.1 Keyword Strategy:</strong> Full keyword universe analysis, 3-tier prioritization</li>
                <li><strong>10.2 Market Position + Competitive Analysis:</strong> Market snapshot, per-competitor profiles, keyword/content/backlink gaps</li>
                <li><strong>10.3 Content Strategy + Blog Calendar:</strong> Topic clusters, PAA/FAQ, location content, 12-month blog calendar</li>
                <li><strong>10.4 CRO Optimization Guide:</strong> Trust signals, conversion elements, performance targets</li>
                <li><strong>10.5 Off-Page Roadmap & Benchmarks:</strong> 90-day GBP/citation/review plan, success metrics</li>
                <li><strong>10.6 Site Architecture + SEO Specs + Technical SEO:</strong> URL hierarchy, per-page SEO specs, internal linking, technical audit</li>
                <li><strong>10.7 UI Design & Styling Direction:</strong> Design archetype, color palette, typography, first principles</li>
                <li><strong>10.8 Project Overview:</strong> Concise summary document for Cursor AI builder</li>
              </ol>
            </div>
          )}

          {/* Actions Bar */}
          <div className="p-4 border-b border-gray-200 flex items-center justify-between">
            <div className="flex items-center space-x-3">
              {activePhase !== 5 && activePhase !== 'build' && (
              <button
                onClick={() => { setIsCreating(true); setEditingPrompt(null); }}
                className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 flex items-center"
              >
                <svg className="w-5 h-5 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                </svg>
                Add Prompt
              </button>
              )}

              {activePhase !== 4 && activePhase !== 5 && activePhase !== 10 && activePhase !== 'build' && (
                <>
                  <button
                    onClick={exportPrompts}
                    className="px-4 py-2 bg-gray-600 text-white rounded-lg hover:bg-gray-700 flex items-center"
                  >
                    <svg className="w-5 h-5 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                    </svg>
                    Export
                  </button>

                  <label className="px-4 py-2 bg-gray-600 text-white rounded-lg hover:bg-gray-700 flex items-center cursor-pointer">
                    <svg className="w-5 h-5 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
                    </svg>
                    Import
                    <input
                      type="file"
                      accept=".json"
                      className="hidden"
                      onChange={(e) => e.target.files?.[0] && importPrompts(e.target.files[0])}
                    />
                  </label>
                </>
              )}
            </div>

            <p className="text-sm text-black">
              {(activePhase === 5 || activePhase === 'build') && 'Edit then Save to update. '}
              {activePhase !== 4 && activePhase !== 5 && activePhase !== 10 && activePhase !== 'build' && 'Drag prompts to reorder • '}
              {activePhase === 5 ? '3 summary prompts' : activePhase === 'build' ? '1 master prompt' : `${prompts.length} total`}
            </p>
          </div>

          {/* Prompts List */}
          <div className="p-4">
            {activePhase === 'build' ? (
              <BuildSitePromptPanel
                prompt={buildSitePrompt}
                onSave={saveBuildSitePrompt}
                saving={saving}
              />
            ) : activePhase === 5 ? (
              <ClaudeSummariesPanel
                summaries={claudeSummaries}
                onSave={saveClaudeSummaries}
                saving={saving}
              />
            ) : prompts.length === 0 ? (
              <div className="text-center py-12">
                <svg className="w-16 h-16 mx-auto text-gray-400 mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                </svg>
                <p className="text-black">No prompts yet. Click "Add Prompt" to create one.</p>
              </div>
            ) : activePhase === 4 || activePhase === 10 ? (
              <>
                {/* Phase 4 / Phase 10: No drag-and-drop (fixed subphase order) */}
                <div className="space-y-3">
                  {prompts.map((prompt) => (
                    <PromptCard
                      key={prompt.id}
                      prompt={prompt}
                      onEdit={() => { setEditingPrompt(prompt); setIsCreating(false); }}
                      onDelete={(prompt as Phase4Prompt & { _isDefault?: boolean })._isDefault || (prompt.id as string).startsWith('default-') ? undefined : () => confirmDelete(prompt.id, prompt.name)}
                      onTest={() => setTestingPrompt(prompt.prompt_template)}
                    />
                  ))}
                </div>

                {/* New flow: after 4.5 = per-page Cursor prompts only (no copy generation) */}
                <div className="mt-6 p-4 bg-blue-50 border border-blue-200 rounded-lg">
                  <h4 className="text-sm font-semibold text-blue-900 mb-2">After 4.5 (current flow)</h4>
                  <p className="text-sm text-blue-800 mb-2">
                    The worker takes the page list from 4.4 and generates <strong>one Cursor IDE prompt per page</strong> (e.g. Home, About, Services). There is no separate page-by-page copy generation step. Those prompts are built by the worker and are not configurable here.
                  </p>
                  <p className="text-xs text-blue-700">
                    Cached context from 4.1–4.5 is reused for cost efficiency when generating each page’s prompt.
                  </p>
                </div>
              </>
            ) : (
              // Phases 1-3: Drag-and-drop enabled
              <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
                <SortableContext items={prompts.map(p => p.id)} strategy={verticalListSortingStrategy}>
                  <div className="space-y-3">
                    {prompts.map((prompt) => (
                      <SortablePromptCard
                        key={prompt.id}
                        prompt={prompt}
                        onEdit={() => { setEditingPrompt(prompt); setIsCreating(false); }}
                        onDelete={() => confirmDelete(prompt.id, prompt.name)}
                        onTest={() => setTestingPrompt(prompt.prompt_template)}
                      />
                    ))}
                  </div>
                </SortableContext>
              </DndContext>
            )}
          </div>
        </div>

        {/* Edit/Create Modal */}
        {(editingPrompt || isCreating) && activePhase !== 'build' && (
          <PromptEditorModal
            prompt={editingPrompt}
            phase={activePhase}
            onSave={(data) => {
              if (editingPrompt) {
                updatePrompt(editingPrompt.id, data);
              } else {
                createPrompt(data);
              }
            }}
            onClose={() => { setEditingPrompt(null); setIsCreating(false); }}
            saving={saving}
          />
        )}

        {/* Test Modal */}
        {testingPrompt && (
          <TestPromptModal
            promptTemplate={testingPrompt}
            onClose={() => setTestingPrompt(null)}
          />
        )}

        {/* Delete Confirmation Modal */}
        {deletingPrompt && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
            <div className="bg-white rounded-lg shadow-xl max-w-md w-full">
              <div className="p-6">
                <div className="flex items-center mb-4">
                  <div className="w-12 h-12 rounded-full bg-red-100 flex items-center justify-center mr-4">
                    <svg className="w-6 h-6 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                    </svg>
                  </div>
                  <div className="flex-1">
                    <h3 className="text-lg font-semibold text-gray-900">Delete Prompt</h3>
                    <p className="text-sm text-gray-600 mt-1">This action cannot be undone</p>
                  </div>
                </div>
                
                <div className="bg-gray-50 border border-gray-200 rounded-lg p-4 mb-6">
                  <p className="text-sm text-black mb-2">Are you sure you want to delete this prompt?</p>
                  <p className="text-sm font-semibold text-gray-900">"{deletingPrompt.name}"</p>
                </div>

                <div className="flex items-center justify-end space-x-3">
                  <button
                    onClick={() => setDeletingPrompt(null)}
                    className="px-4 py-2 text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 font-medium transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={deletePrompt}
                    className="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 font-medium transition-colors flex items-center"
                  >
                    <svg className="w-5 h-5 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                    </svg>
                    Delete Prompt
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// Variables hint for prompt editor (required/optional per phase)
function PromptVariablesHint({ phase, subphase }: { phase: number; subphase?: string }) {
  const variables = getVariablesForPrompt(phase, subphase);
  const required = variables.filter((v) => v.required).map((v) => `{{${v.name}}}`);
  const optional = variables.filter((v) => !v.required).map((v) => `{{${v.name}}}`);
  return (
    <div className="mb-2 rounded bg-gray-100 border border-gray-200 p-2 text-xs text-gray-700">
      <span className="font-medium">Variables: </span>
      {required.length > 0 && (
        <span className="text-amber-700">Required: {required.join(', ')}. </span>
      )}
      {optional.length > 0 && <span>Optional: {optional.join(', ')}</span>}
    </div>
  );
}

// Claude Summaries tab: three prompts with variable hint and Save
function ClaudeSummariesPanel({
  summaries,
  onSave,
  saving,
}: {
  summaries: { phase1: string; phase2: string; phase3: string } | null;
  onSave: (payload: { phase1: string; phase2: string; phase3: string }) => void;
  saving: boolean;
}) {
  const [phase1, setPhase1] = useState(summaries?.phase1 ?? '');
  const [phase2, setPhase2] = useState(summaries?.phase2 ?? '');
  const [phase3, setPhase3] = useState(summaries?.phase3 ?? '');

  useEffect(() => {
    if (summaries) {
      setPhase1(summaries.phase1);
      setPhase2(summaries.phase2);
      setPhase3(summaries.phase3);
    }
  }, [summaries]);

  const handleSave = () => {
    const missing1 = getMissingRequiredVariables(phase1, getVariablesForPrompt(0, 'claude_summary'));
    const missing2 = getMissingRequiredVariables(phase2, getVariablesForPrompt(0, 'claude_summary'));
    const missing3 = getMissingRequiredVariables(phase3, getVariablesForPrompt(0, 'claude_summary'));
    if (missing1.length || missing2.length || missing3.length) {
      const which = [missing1.length && 'Phase 1', missing2.length && 'Phase 2', missing3.length && 'Phase 3'].filter(Boolean).join(', ');
      alert(`Required variable {{RESEARCH_DATA}} is missing in: ${which}. It will be injected by the system; add it to the template.`);
      return;
    }
    onSave({ phase1, phase2, phase3 });
  };

  const variableHint = 'Required: {{RESEARCH_DATA}} — injected with raw research for that phase.';

  return (
    <div className="space-y-6">
      <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
        <strong>Variables:</strong> {variableHint}
      </div>
      {[
        { label: 'Phase 1 – Competitive intelligence summary', value: phase1, set: setPhase1 },
        { label: 'Phase 2 – Keyword & SEO summary', value: phase2, set: setPhase2 },
        { label: 'Phase 3 – Conversion optimization summary', value: phase3, set: setPhase3 },
      ].map(({ label, value, set }) => (
        <div key={label}>
          <label className="block text-sm font-medium text-gray-700 mb-2">{label}</label>
          <textarea
            value={value}
            onChange={(e) => set(e.target.value)}
            rows={12}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 font-mono text-sm text-gray-900"
          />
        </div>
      ))}
      <button
        onClick={handleSave}
        disabled={saving}
        className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
      >
        {saving ? 'Saving...' : 'Save all three prompts'}
      </button>
    </div>
  );
}

// Build Site Prompt tab: single master prompt with Save
function BuildSitePromptPanel({
  prompt,
  onSave,
  saving,
}: {
  prompt: string | null;
  onSave: (prompt: string) => void;
  saving: boolean;
}) {
  const [value, setValue] = useState(prompt ?? '');

  useEffect(() => {
    if (prompt !== null) {
      setValue(prompt);
    }
  }, [prompt]);

  return (
    <div className="space-y-6">
      <div className="rounded-lg border border-green-200 bg-green-50 p-3 text-sm text-green-900">
        <strong>Build Your Site Prompt</strong> — This master prompt is shown on the results page after research completes. Users copy it into Claude along with their research files. Claude then generates a sequenced set of build prompts they can use in Cursor, Claude Code, or any AI coding tool to build their website page by page. No template variables are needed — the prompt is displayed as-is.
      </div>
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-2">Master Build Prompt</label>
        <textarea
          value={value}
          onChange={(e) => setValue(e.target.value)}
          rows={24}
          className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 font-mono text-sm text-gray-900"
        />
      </div>
      <button
        onClick={() => onSave(value)}
        disabled={saving}
        className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50"
      >
        {saving ? 'Saving...' : 'Save prompt'}
      </button>
    </div>
  );
}

// Regular Prompt Card Component (without drag-and-drop, for Phase 4)
function PromptCard({ prompt, onEdit, onDelete, onTest }: {
  prompt: AnyPrompt;
  onEdit: () => void;
  onDelete: (() => void) | undefined;
  onTest: () => void;
}) {
  return (
    <div className="bg-white border border-gray-200 rounded-lg p-4 hover:shadow-md transition-shadow">
      <div className="flex items-start space-x-4">
        {/* Content */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-lg font-semibold text-gray-900">{prompt.name}</h3>
            <span className={`px-2 py-1 text-xs rounded-full ${
              prompt.status === 'active' ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-800'
            }`}>
              {prompt.status}
            </span>
          </div>

          <p className="text-sm text-black mb-2 line-clamp-2">{prompt.prompt_template}</p>
          
          {prompt.internal_notes && (
            <p className="text-xs text-gray-900 italic mb-2">Note: {prompt.internal_notes}</p>
          )}

          {'override_max_results' in prompt && prompt.override_max_results && (
            <p className="text-xs text-blue-600">Override: {prompt.override_max_results} sources</p>
          )}
          
          {'subphase' in prompt && prompt.subphase && (
            <p className="text-xs text-purple-600">Sub-phase: {prompt.subphase}</p>
          )}
        </div>

        {/* Actions */}
        <div className="flex items-center space-x-2">
          <button
            onClick={onTest}
            className="p-2 text-purple-600 hover:bg-purple-50 rounded-lg"
            title="Test prompt"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />
            </svg>
          </button>

          <button
            onClick={onEdit}
            className="p-2 text-blue-600 hover:bg-blue-50 rounded-lg"
            title="Edit prompt"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
            </svg>
          </button>

          {onDelete && (
            <button
              onClick={onDelete}
              className="p-2 text-red-600 hover:bg-red-50 rounded-lg"
              title="Delete prompt"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
              </svg>
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// Sortable Prompt Card Component
function SortablePromptCard({ prompt, onEdit, onDelete, onTest }: {
  prompt: AnyPrompt;
  onEdit: () => void;
  onDelete: () => void;
  onTest: () => void;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: prompt.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className="bg-white border border-gray-200 rounded-lg p-4 hover:shadow-md transition-shadow"
    >
      <div className="flex items-start space-x-4">
        {/* Drag Handle */}
        <div {...attributes} {...listeners} className="cursor-grab active:cursor-grabbing mt-1">
          <svg className="w-5 h-5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 8h16M4 16h16" />
          </svg>
        </div>

        {/* Content */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-lg font-semibold text-gray-900">{prompt.name}</h3>
            <span className={`px-2 py-1 text-xs rounded-full ${
              prompt.status === 'active' ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-800'
            }`}>
              {prompt.status}
            </span>
          </div>

          <p className="text-sm text-black mb-2 line-clamp-2">{prompt.prompt_template}</p>
          
          {prompt.internal_notes && (
            <p className="text-xs text-gray-900 italic mb-2">Note: {prompt.internal_notes}</p>
          )}

          {'override_max_results' in prompt && prompt.override_max_results && (
            <p className="text-xs text-blue-600">Override: {prompt.override_max_results} sources</p>
          )}
          
          {'subphase' in prompt && prompt.subphase && (
            <p className="text-xs text-purple-600">Sub-phase: {prompt.subphase}</p>
          )}
        </div>

        {/* Actions */}
        <div className="flex items-center space-x-2">
          <button
            onClick={onTest}
            className="p-2 text-purple-600 hover:bg-purple-50 rounded-lg"
            title="Test prompt"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />
            </svg>
          </button>

          <button
            onClick={onEdit}
            className="p-2 text-blue-600 hover:bg-blue-50 rounded-lg"
            title="Edit prompt"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
            </svg>
          </button>

          <button
            onClick={onDelete}
            className="p-2 text-red-600 hover:bg-red-50 rounded-lg"
            title="Delete prompt"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
            </svg>
          </button>
        </div>
      </div>
    </div>
  );
}

// Prompt Editor Modal Component
function PromptEditorModal({ prompt, phase, onSave, onClose, saving }: {
  prompt: AnyPrompt | null;
  phase: number;
  onSave: (data: any) => void;
  onClose: () => void;
  saving: boolean;
}) {
  const isPhase4 = phase === 4 || phase === 10;
  const phase4Prompt = isPhase4 && prompt ? prompt as Phase4Prompt : null;
  const regularPrompt = !isPhase4 && prompt ? prompt as ResearchPrompt : null;
  
  const [formData, setFormData] = useState<{
    name: string;
    prompt_template: string;
    internal_notes: string;
    status: 'active' | 'disabled';
    override_max_results?: number | null;
    subphase?: string; // Dynamic subphases (4.1-4.99)
  }>({
    name: prompt?.name || '',
    prompt_template: prompt?.prompt_template || '',
    internal_notes: prompt?.internal_notes || '',
    status: prompt?.status || 'active',
    override_max_results: regularPrompt?.override_max_results ?? null,
    subphase: phase4Prompt?.subphase || (phase === 10 ? '10.1' : '4.1')
  });

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg max-w-3xl w-full max-h-[90vh] overflow-y-auto">
        <div className="p-6 border-b border-gray-200">
          <h2 className="text-2xl font-bold text-gray-900">
            {prompt ? 'Edit Prompt' : 'Create New Prompt'}
          </h2>
          <p className="text-sm text-black mt-1">Phase {phase}: {PHASE_NAMES[phase]}</p>
        </div>

        <div className="p-6 space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Prompt Name *
            </label>
            <input
              type="text"
              value={formData.name}
              onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent text-gray-900"
              placeholder="e.g., Top Competitors & Market Leaders"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Prompt Template *
            </label>
            <PromptVariablesHint phase={phase} subphase={formData.subphase} />
            <textarea
              value={formData.prompt_template}
              onChange={(e) => setFormData({ ...formData, prompt_template: e.target.value })}
              rows={8}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent font-mono text-sm text-gray-900"
              placeholder="Find the top-rated {{INDUSTRY}} businesses in {{LOCATION}}..."
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-black mb-2">
              Internal Notes (optional)
            </label>
            <textarea
              value={formData.internal_notes}
              onChange={(e) => setFormData({ ...formData, internal_notes: e.target.value })}
              rows={2}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent text-gray-900"
              placeholder="For your reference: what this prompt targets..."
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-black mb-2">
                Status
              </label>
              <select
                value={formData.status}
                onChange={(e) => setFormData({ ...formData, status: e.target.value as 'active' | 'disabled' })}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent text-gray-900"
              >
                <option value="active">Active</option>
                <option value="disabled">Disabled</option>
              </select>
            </div>

            {isPhase4 ? (
              <div>
                <label className="block text-sm font-medium text-black mb-2">
                  Sub-phase
                </label>
                <select
                  value={formData.subphase || (phase === 10 ? '10.1' : '4.1')}
                  onChange={(e) => setFormData({ ...formData, subphase: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent text-gray-900"
                >
                  {phase === 10 ? (
                    <>
                      <option value="10.1">10.1 - Keyword Strategy & Prioritization</option>
                      <option value="10.2">10.2 - Market Position + Competitive Analysis</option>
                      <option value="10.3">10.3 - Content Strategy & Blog Calendar</option>
                      <option value="10.4">10.4 - CRO Optimization Guide</option>
                      <option value="10.5">10.5 - Off-Page Roadmap & Benchmarks</option>
                      <option value="10.6">10.6 - Site Architecture + SEO Specs + Technical SEO</option>
                      <option value="10.7">10.7 - UI Design & Styling Direction</option>
                      <option value="10.8">10.8 - Project Overview</option>
                    </>
                  ) : (
                    <>
                      <option value="4.1">4.1 - Competitive Intelligence</option>
                      <option value="4.2">4.2 - SEO Strategy</option>
                      <option value="4.3">4.3 - CRO Guide</option>
                      <option value="4.4">4.4 - Wireframe/Outline</option>
                      <option value="4.5">4.5 - UI Design & Color Palette</option>
                    </>
                  )}
                </select>
              </div>
            ) : (
              <div>
                <label className="block text-sm font-medium text-black mb-2">
                  Override Max Results (optional)
                </label>
                <input
                  type="number"
                  min="1"
                  max="20"
                  value={formData.override_max_results || ''}
                  onChange={(e) => setFormData({ ...formData, override_max_results: e.target.value ? parseInt(e.target.value) : null })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent text-gray-900"
                  placeholder="Use global setting"
                />
              </div>
            )}
          </div>
        </div>

        <div className="p-6 border-t border-gray-200 flex items-center justify-end space-x-3">
          <button
            onClick={onClose}
            className="px-4 py-2 text-gray-700 hover:bg-gray-100 rounded-lg"
            disabled={saving}
          >
            Cancel
          </button>
          <button
            onClick={() => {
              const variables = getVariablesForPrompt(phase, formData.subphase);
              const missing = getMissingRequiredVariables(formData.prompt_template, variables);
              if (missing.length > 0) {
                alert(`Required variable(s) missing: ${missing.map((m) => `{{${m}}}`).join(', ')}. Add them to avoid breaking the system.`);
                return;
              }
              onSave(formData);
            }}
            disabled={saving || !formData.name || !formData.prompt_template}
            className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
          >
            {saving ? 'Saving...' : 'Save Prompt'}
          </button>
        </div>
      </div>
    </div>
  );
}

// Test Prompt Modal Component
function TestPromptModal({ promptTemplate, onClose }: {
  promptTemplate: string;
  onClose: () => void;
}) {
  const [testData, setTestData] = useState({
    industry: 'roofing',
    location: 'Orlando, FL',
    services: 'roof repair, roof replacement',
    target_audience: 'homeowners',
    search_radius: '25'
  });
  const [testing, setTesting] = useState(false);
  const [results, setResults] = useState<any>(null);

  async function runTest() {
    setTesting(true);
    setResults(null);

    try {
      const response = await fetch('/api/admin/research-prompts/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ promptTemplate, testData })
      });

      const data = (await response.json()) as Record<string, unknown> & { error?: string };

      if (response.ok) {
        setResults(data);
      } else {
        setResults({ error: data.error || 'Test failed' });
      }
    } catch (error) {
      setResults({ error: 'Test failed' });
    } finally {
      setTesting(false);
    }
  }

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg max-w-4xl w-full max-h-[90vh] overflow-y-auto">
        <div className="p-6 border-b border-gray-200">
          <h2 className="text-2xl font-bold text-gray-900">Test Prompt</h2>
          <p className="text-sm text-black mt-1">Preview results with sample data</p>
        </div>

        <div className="p-6 space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-black mb-2">Industry</label>
              <input
                type="text"
                value={testData.industry}
                onChange={(e) => setTestData({ ...testData, industry: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-black mb-2">Location</label>
              <input
                type="text"
                value={testData.location}
                onChange={(e) => setTestData({ ...testData, location: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-black mb-2">Services</label>
              <input
                type="text"
                value={testData.services}
                onChange={(e) => setTestData({ ...testData, services: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-black mb-2">Target Audience</label>
              <input
                type="text"
                value={testData.target_audience}
                onChange={(e) => setTestData({ ...testData, target_audience: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg"
              />
            </div>
          </div>

          <button
            onClick={runTest}
            disabled={testing}
            className="w-full px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 disabled:opacity-50"
          >
            {testing ? 'Running Test...' : 'Run Test (5 sources)'}
          </button>

          {results && (
            <div className="mt-6">
              {results.error ? (
                <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-red-800">
                  {results.error}
                </div>
              ) : (
                <>
                  <div className="bg-gray-50 border border-gray-200 rounded-lg p-4 mb-4">
                    <h3 className="font-semibold text-gray-900 mb-2">Generated Query:</h3>
                    <p className="text-sm text-black">{results.query}</p>
                  </div>

                  <h3 className="font-semibold text-gray-900 mb-3">Results ({results.sources.length} sources):</h3>
                  <div className="space-y-3">
                    {results.sources.map((source: any, idx: number) => (
                      <div key={idx} className="bg-white border border-gray-200 rounded-lg p-4">
                        <h4 className="font-medium text-gray-900 mb-1">{source.title}</h4>
                        <a href={source.url} target="_blank" rel="noopener noreferrer" className="text-xs text-blue-600 hover:underline mb-2 block">
                          {source.url}
                        </a>
                        <p className="text-sm text-black">{source.content}</p>
                        <p className="text-xs text-gray-900 mt-2">Score: {source.score}</p>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </div>
          )}
        </div>

        <div className="p-6 border-t border-gray-200 flex items-center justify-end">
          <button
            onClick={onClose}
            className="px-4 py-2 text-gray-700 hover:bg-gray-100 rounded-lg"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
