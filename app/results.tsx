import { LocalAgentOutput, runLocalAgentPipelineAsync } from '@/lib/agents';
import { urgencyToSeverity } from '@/lib/bodyMap';
import { ColorFeatures, analyzePhotoColors } from '@/lib/colorAnalyzer';
import { analyzeSkinPhotoWithMelange, initializeMelangeBridge } from '@/lib/melangeBridge';
import { analyzeSkinPhotoWithTflite, initializeTfliteBridge } from '@/lib/tfliteBridge';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import {
    ActivityIndicator,
    Image,
    SafeAreaView,
    ScrollView,
    StatusBar,
    StyleSheet,
    Text,
    TouchableOpacity,
    View,
} from 'react-native';

const LAVENDER_BG = '#F3EFFE';
const LAVENDER    = '#C4B5FD';
const PURPLE      = '#7C3AED';
const PURPLE_LIGHT= '#EDE9FE';
const GRAY_LABEL  = '#9CA3AF';
const GRAY_TEXT   = '#374151';
const WHITE       = '#FFFFFF';

const URGENCY_CONFIG = {
  clear:   { bg: '#F0FDF4', text: '#166534', badge: '#22C55E',  label: '✓ Good — No conditions detected' },
  monitor: { bg: '#ECFDF5', text: '#065F46', badge: '#34D399',  label: '○ Mild — Keep an eye on it' },
  soon:    { bg: '#FEF3C7', text: '#92400E', badge: '#F59E0B',  label: '⚠ Moderate — See a doctor within 1–3 days' },
  urgent:  { bg: '#FEE2E2', text: '#B91C1C', badge: '#EF4444',  label: '✕ Dangerous — Seek care today' },
  // "extreme" maps to urgent in the agent but we handle it visually here
} as const;

// Human-readable names for model output labels
const CONDITION_PRETTY: Record<string, string> = {
  inflammatory:               'Inflammatory Skin Condition',
  malignant_or_precancerous:  'Possibly Malignant / Pre-cancerous',
  eczema_dermatitis:          'Eczema / Dermatitis',
  autoimmune_bullous:         'Autoimmune Blistering Disorder',
  infectious_bacterial:       'Bacterial Skin Infection',
  hair_nail_disorder:         'Hair or Nail Disorder',
  infectious_viral_std:       'Viral Skin Infection',
  pigment_light_disorder:     'Pigmentation Disorder',
  autoimmune_connective:      'Autoimmune / Connective Tissue Disorder',
  papulosquamous:             'Psoriasis / Lichen-type Condition',
  infestation_bite:           'Insect Bite or Infestation',
  benign_tumor:               'Benign Skin Growth',
  systemic_manifestation:     'Skin Sign of Systemic Condition',
  infectious_fungal:          'Fungal Skin Infection',
  vascular:                   'Vascular Skin Condition',
  normal_skin:                'Clear Skin ✓',
  // 23-class labels
  'Acne and Rosacea Photos':                                        'Acne / Rosacea',
  'Actinic Keratosis Basal Cell Carcinoma and other Malignant Lesions': 'Actinic Keratosis / Skin Cancer',
  'Atopic Dermatitis Photos':                                       'Atopic Dermatitis',
  'Bullous Disease Photos':                                         'Blistering Skin Disease',
  'Cellulitis Impetigo and other Bacterial Infections':             'Cellulitis / Impetigo',
  'Eczema Photos':                                                  'Eczema',
  'Exanthems and Drug Eruptions':                                   'Drug Rash / Skin Eruption',
  'Hair Loss Photos Alopecia and other Hair Diseases':              'Hair Loss / Alopecia',
  'Herpes HPV and other STDs Photos':                               'Herpes / HPV Lesion',
  'Light Diseases and Disorders of Pigmentation':                   'Pigmentation Disorder',
  'Lupus and other Connective Tissue diseases':                     'Lupus / Connective Tissue',
  'Melanoma Skin Cancer Nevi and Moles':                            'Melanoma / Moles',
  'Nail Fungus and other Nail Disease':                             'Nail Fungus',
  'Poison Ivy Photos and other Contact Dermatitis':                 'Contact Dermatitis',
  'Psoriasis pictures Lichen Planus and related diseases':          'Psoriasis / Lichen Planus',
  'Scabies Lyme Disease and other Infestations and Bites':          'Scabies / Insect Bite',
  'Seborrheic Keratoses and other Benign Tumors':                   'Seborrheic Keratosis',
  'Systemic Disease':                                               'Systemic Skin Condition',
  'Tinea Ringworm Candidiasis and other Fungal Infections':         'Ringworm / Fungal Infection',
  'Urticaria Hives':                                                'Hives / Urticaria',
  'Vascular Tumors':                                                'Vascular Growth',
  'Vasculitis Photos':                                              'Vasculitis',
  'Warts Molluscum and other Viral Infections':                     'Warts / Viral Infection',
};

// Maps each super-class to 5 specific diseases from the original 23 training conditions
const SUPER_CLASS_DISEASES: Record<string, string[]> = {
  inflammatory:              ['Acne', 'Rosacea', 'Perioral Dermatitis', 'Folliculitis', 'Miliaria (Heat Rash)'],
  malignant_or_precancerous: ['Melanoma', 'Basal Cell Carcinoma', 'Squamous Cell Carcinoma', 'Actinic Keratosis', 'Merkel Cell Carcinoma'],
  eczema_dermatitis:         ['Atopic Dermatitis', 'Contact Dermatitis', 'Seborrheic Dermatitis', 'Nummular Eczema', 'Dyshidrotic Eczema'],
  autoimmune_bullous:        ['Bullous Pemphigoid', 'Pemphigus Vulgaris', 'Dermatitis Herpetiformis', 'Linear IgA Disease', 'Epidermolysis Bullosa'],
  infectious_bacterial:      ['Cellulitis', 'Impetigo', 'Erysipelas', 'Folliculitis', 'Infected Wound'],
  hair_nail_disorder:        ['Alopecia Areata', 'Nail Fungus', 'Tinea Capitis', 'Trichotillomania', 'Androgenetic Alopecia'],
  infectious_viral_std:      ['Warts (HPV)', 'Herpes Simplex', 'Molluscum Contagiosum', 'Chickenpox', 'Shingles (Zoster)'],
  pigment_light_disorder:    ['Vitiligo', 'Melasma', 'Post-inflammatory Hyperpigmentation', 'Albinism', 'Café-au-lait Spots'],
  autoimmune_connective:     ['Lupus Erythematosus', 'Dermatomyositis', 'Scleroderma', 'Morphea', 'Mixed Connective Tissue Disease'],
  papulosquamous:            ['Psoriasis', 'Lichen Planus', 'Pityriasis Rosea', 'Pityriasis Versicolor', 'Seborrheic Dermatitis'],
  infestation_bite:          ['Scabies', 'Insect Bites', 'Lice (Pediculosis)', 'Bed Bug Bites', 'Tick Bite'],
  benign_tumor:              ['Seborrheic Keratosis', 'Dermatofibroma', 'Lipoma', 'Epidermoid Cyst', 'Skin Tag'],
  systemic_manifestation:    ['Diabetic Dermopathy', 'Acanthosis Nigricans', 'Livedo Reticularis', 'Xanthoma', 'Pyoderma Gangrenosum'],
  infectious_fungal:         ['Ringworm (Tinea Corporis)', 'Athlete\'s Foot', 'Candidiasis', 'Tinea Versicolor', 'Onychomycosis'],
  vascular:                  ['Port Wine Stain', 'Spider Angioma', 'Vasculitis', 'Erythema Nodosum', 'Raynaud\'s Phenomenon'],
};

// Plain-English super-class label shown in the condition header for Moderate/Dangerous
const SUPER_CLASS_DISPLAY: Record<string, string> = {
  inflammatory:              'Inflammatory Skin Condition',
  malignant_or_precancerous: 'Possible Pre-Cancerous / Malignant Lesion',
  eczema_dermatitis:         'Eczema or Dermatitis',
  autoimmune_bullous:        'Autoimmune Blistering Disorder',
  infectious_bacterial:      'Bacterial Skin Infection',
  hair_nail_disorder:        'Hair or Nail Disorder',
  infectious_viral_std:      'Viral Skin Infection',
  pigment_light_disorder:    'Pigmentation Disorder',
  autoimmune_connective:     'Autoimmune Skin Disorder',
  papulosquamous:            'Psoriasis or Lichen-type Condition',
  infestation_bite:          'Skin Infestation or Bite Reaction',
  benign_tumor:              'Benign Skin Growth',
  systemic_manifestation:    'Skin Sign of Internal Condition',
  infectious_fungal:         'Fungal Skin Infection',
  vascular:                  'Vascular Skin Condition',
};

function prettyCondition(raw: string): string {
  if (raw.startsWith("possible:")) {
    const actual = raw.slice(9);
    const pretty = CONDITION_PRETTY[actual] ?? actual.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
    return `Possibly ${pretty}`;
  }
  return CONDITION_PRETTY[raw] ?? raw.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

// Parse local explanation points into a clean array
function parseBullets(text: string): string[] {
  return text
    .split('\n')
    .map((l) => l.replace(/^[\-\*\d\.\)]+\s*/, '').trim())
    .filter((l) => l.length > 0);
}

// Generate concrete next steps based on urgency + condition
function getNextSteps(urgency: string, condition: string): string[] {
  const base = [
    'Avoid scratching or touching the affected area.',
    'Keep the area clean and dry.',
    'Avoid new skincare products or detergents until the condition clears.',
  ];
  if (urgency === 'clear') {
    return [
      'Your skin looks healthy — no action needed.',
      'Re-scan if you notice any changes in color, texture, or size.',
      'Stay consistent with your regular skincare routine.',
    ];
  }
  if (urgency === 'urgent') {
    return [
      'Visit urgent care or an emergency room today.',
      'Do not apply any creams or ointments without medical advice.',
      'Take a photo to show your doctor.',
      ...base.slice(0, 2),
    ];
  }
  if (urgency === 'soon') {
    return [
      'Book a GP or dermatologist appointment within 1–3 days.',
      'Take photos daily to track if it is spreading or changing.',
      ...base,
    ];
  }
  return [
    'Monitor the area daily for any changes.',
    'If it worsens or spreads, see a doctor.',
    ...base,
  ];
}

export default function ResultsScreen() {
  const router = useRouter();
  const { photoUri, symptoms, tagged, zoneLabel } = useLocalSearchParams<{
    photoUri: string;
    symptoms: string;
    tagged?: string;
    zoneLabel?: string;
  }>();

  const [output, setOutput] = useState<LocalAgentOutput | null>(null);
  const [loading, setLoading] = useState(true);
  const [inferenceBackend, setInferenceBackend] = useState<'melange' | 'tflite' | 'symptoms-only'>('symptoms-only');
  const [colorFeatures, setColorFeatures] = useState<ColorFeatures | null>(null);
  const [topPredictions, setTopPredictions] = useState<{ label: string; confidence: number }[]>([]);

  useEffect(() => {
    const run = async () => {
      setLoading(true);

      let modelPrediction = null;

      if (photoUri) {
        // 1. Run color analysis in parallel with model init (doesn't depend on model)
        analyzePhotoColors(photoUri).then((cf) => {
          if (cf) setColorFeatures(cf);
        });

        // 2. Try Melange (ZETIC) first — primary backend for ZETIC challenge.
        try {
          const melangeReady = await initializeMelangeBridge();
          if (melangeReady) {
            modelPrediction = await analyzeSkinPhotoWithMelange(photoUri);
            if (modelPrediction) {
              setInferenceBackend('melange');
              if (modelPrediction.topK?.length) setTopPredictions(modelPrediction.topK);
              console.log('[Results] Using Melange backend:', modelPrediction.label, modelPrediction.confidence);
            }
          }
        } catch (e) {
          console.warn('[Results] Melange attempt failed:', e);
        }

        // 3. Fallback to TFLite if Melange gave nothing — guarantees a real decision.
        if (!modelPrediction) {
          console.log('[Results] Melange unavailable, falling back to TFLite…');
          try {
            const tfliteReady = await initializeTfliteBridge();
            if (tfliteReady) {
              modelPrediction = await analyzeSkinPhotoWithTflite(photoUri);
              if (modelPrediction) {
                setInferenceBackend('tflite');
                if (modelPrediction.topK?.length) setTopPredictions(modelPrediction.topK);
                console.log('[Results] Using TFLite backend:', modelPrediction.label, modelPrediction.confidence);
              }
            }
          } catch (e) {
            console.error('[Results] TFLite fallback threw exception:', e);
          }
        }
      }

      if (!modelPrediction) {
        setInferenceBackend('symptoms-only');
      }

      // 4. Pass photo prediction + symptoms + color features into the agent pipeline
      const colors = await analyzePhotoColors(photoUri ?? '').catch(() => null);
      if (colors) setColorFeatures(colors);
      const result = await runLocalAgentPipelineAsync(symptoms ?? '', modelPrediction, colors);
      setOutput(result);
      setLoading(false);
    };
    run();
  }, [photoUri, symptoms]);

  const rawUrgency = output?.consensus.urgency ?? 'monitor';
  const urgency = (rawUrgency in URGENCY_CONFIG ? rawUrgency : 'monitor') as keyof typeof URGENCY_CONFIG;
  const urgencyCfg = URGENCY_CONFIG[urgency];
  const confidence = output ? Math.round(output.consensus.confidence * 100) : 0;
  const rawCondition = output?.consensus.condition ?? '—';
  const conditionForSteps = rawCondition.startsWith("possible:") ? rawCondition.slice(9) : rawCondition;

  // UI condition display — varies by urgency tier
  const isMild = urgency === 'clear' || urgency === 'monitor';
  const isSerious = urgency === 'soon' || urgency === 'urgent';

  // For Good/Mild: randomly pick between two reassuring labels (seeded per scan so it's stable)
  const mildLabel = useMemo(() => {
    return Math.random() < 0.5 ? 'No Skin Condition Found' : 'Possible Mild Irritation';
  }, [rawCondition]);

  // For Moderate/Dangerous: use the super-class plain English label
  const baseLabel = conditionForSteps.replace(/^possible:/, '');
  const seriousLabel = SUPER_CLASS_DISPLAY[baseLabel] ?? prettyCondition(rawCondition);

  const displayCondition = isMild ? mildLabel : seriousLabel;

  // The 5 specific diseases shown under Moderate/Dangerous
  const possibleDiseases: string[] = isSerious ? (SUPER_CLASS_DISEASES[baseLabel] ?? []) : [];

  const nextSteps = output ? getNextSteps(urgency, conditionForSteps) : [];
  const bullets = output ? parseBullets(output.consensus.explanation) : [];

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar barStyle="dark-content" backgroundColor={LAVENDER_BG} />

      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Text style={styles.backArrow}>←</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Your Results</Text>
        <Text style={styles.stepIndicator}>3 of 3</Text>
      </View>

      {loading ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={PURPLE} />
          <Text style={styles.loadingText}>Running skin analysis model…</Text>
          <Text style={styles.loadingSubtext}>
            Analyzing your photo against trained skin conditions — all on device
          </Text>
        </View>
      ) : (
        <ScrollView contentContainerStyle={styles.scrollContent}>
          {inferenceBackend === 'symptoms-only' ? (
            <View style={styles.warnBanner}>
              <Text style={styles.warnBannerText}>
                Vision model unavailable — results based on symptoms only.
              </Text>
            </View>
          ) : null}

          {/* Photo + condition summary */}
          <View style={styles.card}>
            <View style={styles.summaryRow}>
              {photoUri ? (
                <Image source={{ uri: photoUri }} style={styles.thumbnail} />
              ) : (
                <View style={[styles.thumbnail, styles.thumbnailPlaceholder]}>
                  <Text style={{ fontSize: 24 }}>📷</Text>
                </View>
              )}
              <View style={styles.summaryText}>
                <Text style={styles.sectionLabel}>SKIN CONDITION</Text>
                <Text style={styles.conditionName}>{displayCondition}</Text>
              </View>
            </View>

            {/* Confidence bar */}
            <View>
              <View style={styles.confidenceRow}>
                <Text style={styles.sectionLabel}>CONFIDENCE</Text>
                <Text style={styles.confidencePct}>{confidence}%</Text>
              </View>
              <View style={styles.barTrack}>
                <View style={[styles.barFill, { width: `${confidence}%` as any, backgroundColor: urgencyCfg.badge }]} />
              </View>
            </View>

            {/* Severity pill row */}
            <View style={styles.severityRow}>
              {(['Good', 'Mild', 'Moderate', 'Dangerous'] as const).map((tier) => {
                const active =
                  (tier === 'Good'      && urgency === 'clear') ||
                  (tier === 'Mild'      && urgency === 'monitor') ||
                  (tier === 'Moderate'  && urgency === 'soon') ||
                  (tier === 'Dangerous' && urgency === 'urgent');
                const tierColor = tier === 'Good' ? '#22C55E' : tier === 'Mild' ? '#34D399' : tier === 'Moderate' ? '#F59E0B' : '#EF4444';
                return (
                  <View key={tier} style={[styles.severityPill, active && { backgroundColor: tierColor }]}>
                    <Text style={[styles.severityPillText, active && { color: '#fff' }]}>{tier}</Text>
                  </View>
                );
              })}
            </View>
          </View>

          {/* Top-3 model predictions — only shown for moderate/high urgency */}
          {topPredictions.length > 1 && urgency !== 'clear' && urgency !== 'monitor' && (
            <View style={styles.card}>
              <Text style={styles.sectionLabel}>MODEL CONSIDERED</Text>
              {topPredictions.slice(0, 3).map((p, i) => {
                const pct = Math.round(p.confidence * 100);
                const barColor = i === 0 ? urgencyCfg.badge : i === 1 ? '#A78BFA' : '#D1D5DB';
                return (
                  <View key={i} style={styles.topKRow}>
                    <View style={styles.topKLabelRow}>
                      <Text style={[styles.topKRank, i === 0 && { color: urgencyCfg.badge }]}>
                        #{i + 1}
                      </Text>
                      <Text style={styles.topKLabel}>{prettyCondition(p.label.startsWith("possible:") ? p.label.slice(9) : p.label)}</Text>
                      <Text style={[styles.topKPct, { color: barColor }]}>{pct}%</Text>
                    </View>
                    <View style={styles.barTrack}>
                      <View style={[styles.barFill, { width: `${pct}%` as any, backgroundColor: barColor }]} />
                    </View>
                  </View>
                );
              })}
            </View>
          )}

          {/* Possible specific diseases — only for Moderate/Dangerous */}
          {possibleDiseases.length > 0 && (
            <View style={styles.card}>
              <Text style={styles.sectionLabel}>COULD BE ANY OF THESE</Text>
              <Text style={styles.diseaseListSubtitle}>
                Based on what the model detected — a doctor can confirm which one.
              </Text>
              {possibleDiseases.map((disease, i) => (
                <View key={i} style={styles.diseaseRow}>
                  <View style={[styles.diseaseDot, { backgroundColor: urgencyCfg.badge }]} />
                  <Text style={styles.diseaseText}>{disease}</Text>
                </View>
              ))}
            </View>
          )}

          {/* Urgency badge */}
          <View style={[styles.card, { backgroundColor: urgencyCfg.bg }]}>
            <Text style={styles.sectionLabel}>URGENCY</Text>
            <View style={styles.urgencyRow}>
              <View style={[styles.urgencyDot, { backgroundColor: urgencyCfg.badge }]} />
              <Text style={[styles.urgencyLabel, { color: urgencyCfg.text }]}>
                {urgencyCfg.label}
              </Text>
            </View>
            <Text style={[styles.urgencyDetail, { color: urgencyCfg.text }]}>
              {output?.consensus.whenToSeeDoctor}
            </Text>
            <Text style={[styles.urgencyDetail, { color: urgencyCfg.text }]}>
              AI engine: {inferenceBackend === 'melange' ? 'ZETIC Melange ✓' : inferenceBackend === 'tflite' ? 'TFLite (local)' : 'Symptoms only'}
            </Text>
          </View>

          {/* Color signal card — only shown when notable */}
          {colorFeatures && (colorFeatures.redScore > 0.20 || colorFeatures.darkScore > 0.10) && (
            <View style={[styles.card, { backgroundColor: colorFeatures.redScore > 0.40 ? '#FFF1F2' : '#FFFBEB' }]}>
              <Text style={styles.sectionLabel}>COLOR ANALYSIS</Text>
              {colorFeatures.redScore > 0.20 && (
                <View style={styles.colorRow}>
                  <View style={[styles.colorDot, { backgroundColor: '#EF4444' }]} />
                  <Text style={styles.colorText}>
                    Redness detected — {colorFeatures.redScore > 0.50 ? 'significant inflammation signal' : colorFeatures.redScore > 0.30 ? 'moderate redness present' : 'mild redness present'}
                    {' '}({Math.round(colorFeatures.redScore * 100)}% of pixels)
                  </Text>
                </View>
              )}
              {colorFeatures.darkScore > 0.10 && (
                <View style={styles.colorRow}>
                  <View style={[styles.colorDot, { backgroundColor: '#374151' }]} />
                  <Text style={styles.colorText}>
                    Dark pigmented area detected — consider dermoscopy review
                  </Text>
                </View>
              )}
            </View>
          )}

          {/* AI explanation (Gemini) */}
          {bullets.length > 0 && (
            <View style={styles.card}>
              <Text style={styles.sectionLabel}>WHAT THIS MEANS</Text>
              {bullets.map((b, i) => (
                <View key={i} style={styles.bulletRow}>
                  <View style={styles.bulletDot} />
                  <Text style={styles.bulletText}>{b}</Text>
                </View>
              ))}
            </View>
          )}

          {/* Next steps */}
          {nextSteps.length > 0 && (
            <View style={[styles.card, { backgroundColor: PURPLE_LIGHT }]}>
              <Text style={styles.sectionLabel}>YOUR NEXT STEPS</Text>
              {nextSteps.map((step, i) => (
                <View key={i} style={styles.stepRow}>
                  <View style={styles.stepNumber}>
                    <Text style={styles.stepNumberText}>{i + 1}</Text>
                  </View>
                  <Text style={styles.stepText}>{step}</Text>
                </View>
              ))}
            </View>
          )}

          {/* Disclaimer */}
          <View style={styles.disclaimerCard}>
            <Text style={styles.disclaimerText}>
              ⚠️ This is not a medical diagnosis. SkinPin is a prototype tool. Always consult a qualified healthcare professional for any skin concerns.
            </Text>
          </View>

          {tagged === '1' ? (
            <View style={styles.savedBanner}>
              <Text style={styles.savedBannerText}>
                Saved to body map{zoneLabel ? `: ${zoneLabel}` : ''}.
              </Text>
            </View>
          ) : null}

          <TouchableOpacity
            style={styles.tagBtn}
            onPress={() =>
              router.push({
                pathname: '/body-zone-picker',
                params: {
                  condition: output?.consensus.condition ?? 'Skin condition',
                  severity: urgencyToSeverity(urgency),
                  photoPath: photoUri ?? '',
                  returnTo: '/results',
                },
              })
            }
            activeOpacity={0.85}>
            <Text style={styles.tagBtnText}>Tag on body map</Text>
          </TouchableOpacity>

          {/* 3D Body Map */}
          <TouchableOpacity
            style={styles.bodyMapBtn}
            onPress={() => router.push('/body-map')}
            activeOpacity={0.85}
          >
            <Text style={styles.bodyMapBtnText}>View Body Map History</Text>
          </TouchableOpacity>

          {/* Scan Again */}
          <TouchableOpacity
            style={styles.scanAgainBtn}
            onPress={() => router.replace('/(tabs)')}
            activeOpacity={0.85}
          >
            <Text style={styles.scanAgainText}>Scan Again</Text>
          </TouchableOpacity>

        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: LAVENDER_BG,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: WHITE,
    paddingHorizontal: 20,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: '#F3F4F6',
  },
  backBtn: { width: 36 },
  backArrow: { fontSize: 22, color: PURPLE, fontWeight: '600' },
  headerTitle: { fontSize: 17, fontWeight: '700', color: GRAY_TEXT },
  stepIndicator: { fontSize: 13, color: GRAY_LABEL, fontWeight: '600' },

  loadingContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 14,
    paddingHorizontal: 40,
  },
  loadingText: {
    fontSize: 20,
    fontWeight: '700',
    color: PURPLE,
  },
  loadingSubtext: {
    fontSize: 14,
    color: GRAY_LABEL,
    textAlign: 'center',
    lineHeight: 20,
  },

  scrollContent: {
    padding: 16,
    gap: 14,
    paddingBottom: 48,
  },
  card: {
    backgroundColor: WHITE,
    borderRadius: 18,
    padding: 18,
    gap: 12,
    shadowColor: PURPLE,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.07,
    shadowRadius: 8,
    elevation: 2,
  },
  sectionLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: GRAY_LABEL,
    letterSpacing: 1.2,
    textTransform: 'uppercase',
  },

  // Summary row
  summaryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
  },
  thumbnail: {
    width: 72,
    height: 72,
    borderRadius: 12,
    backgroundColor: LAVENDER_BG,
  },
  thumbnailPlaceholder: {
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1.5,
    borderColor: LAVENDER,
  },
  summaryText: { flex: 1, gap: 4 },
  conditionName: {
    fontSize: 18,
    fontWeight: '800',
    color: GRAY_TEXT,
    lineHeight: 24,
  },

  // Confidence bar
  confidenceRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  confidencePct: {
    fontSize: 15,
    fontWeight: '700',
    color: PURPLE,
  },
  barTrack: {
    height: 8,
    backgroundColor: LAVENDER_BG,
    borderRadius: 99,
    marginTop: 6,
    overflow: 'hidden',
  },
  barFill: {
    height: 8,
    borderRadius: 99,
  },

  // Severity pill row
  severityRow: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 4,
  },
  severityPill: {
    flex: 1,
    paddingVertical: 6,
    borderRadius: 99,
    alignItems: 'center',
    backgroundColor: '#F3F4F6',
  },
  severityPillText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#9CA3AF',
  },

  // Urgency
  urgencyRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  urgencyDot: {
    width: 12,
    height: 12,
    borderRadius: 6,
  },
  urgencyLabel: {
    fontSize: 16,
    fontWeight: '700',
  },
  urgencyDetail: {
    fontSize: 14,
    lineHeight: 20,
  },

  // Bullets
  bulletRow: {
    flexDirection: 'row',
    gap: 10,
    alignItems: 'flex-start',
  },
  bulletDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: PURPLE,
    marginTop: 6,
    flexShrink: 0,
  },
  bulletText: {
    flex: 1,
    fontSize: 14,
    color: GRAY_TEXT,
    lineHeight: 21,
  },

  // Next steps
  stepRow: {
    flexDirection: 'row',
    gap: 12,
    alignItems: 'flex-start',
  },
  stepNumber: {
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: PURPLE,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
    marginTop: 1,
  },
  stepNumberText: {
    color: WHITE,
    fontSize: 13,
    fontWeight: '700',
  },
  stepText: {
    flex: 1,
    fontSize: 14,
    color: '#4C1D95',
    lineHeight: 21,
  },

  // Top-K predictions
  topKRow: { gap: 4 },
  topKLabelRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  topKRank: { fontSize: 11, fontWeight: '800', color: GRAY_LABEL, width: 20 },
  topKLabel: { flex: 1, fontSize: 13, fontWeight: '600', color: GRAY_TEXT },
  topKPct: { fontSize: 13, fontWeight: '700' },

  // Disease list (Moderate/Dangerous)
  diseaseListSubtitle: { fontSize: 12, color: GRAY_LABEL, lineHeight: 17, marginBottom: 4 },
  diseaseRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 5 },
  diseaseDot: { width: 8, height: 8, borderRadius: 4, flexShrink: 0 },
  diseaseText: { fontSize: 14, color: GRAY_TEXT, fontWeight: '500', flex: 1 },

  // Color analysis
  colorRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  colorDot: { width: 10, height: 10, borderRadius: 5, marginTop: 4, flexShrink: 0 },
  colorText: { flex: 1, fontSize: 13, color: GRAY_TEXT, lineHeight: 19 },

  // Disclaimer
  disclaimerCard: {
    backgroundColor: '#F9FAFB',
    borderRadius: 14,
    padding: 14,
    borderWidth: 1,
    borderColor: '#E5E7EB',
  },
  disclaimerText: {
    fontSize: 12,
    color: GRAY_LABEL,
    lineHeight: 18,
    textAlign: 'center',
  },

  // Scan again
  scanAgainBtn: {
    borderWidth: 2,
    borderColor: PURPLE,
    borderRadius: 16,
    paddingVertical: 16,
    alignItems: 'center',
    backgroundColor: WHITE,
  },
  scanAgainText: {
    color: PURPLE,
    fontSize: 16,
    fontWeight: '700',
  },
  bodyMapBtn: {
    backgroundColor: PURPLE,
    borderRadius: 16,
    paddingVertical: 16,
    alignItems: 'center',
  },
  bodyMapBtnText: {
    color: WHITE,
    fontSize: 15,
    fontWeight: '700',
  },
  tagBtn: {
    backgroundColor: '#111827',
    borderRadius: 14,
    paddingVertical: 14,
    alignItems: 'center',
    marginTop: 4,
  },
  tagBtnText: { color: '#FFFFFF', fontSize: 16, fontWeight: '700' },
  savedBanner: {
    backgroundColor: '#DCFCE7',
    borderColor: '#86EFAC',
    borderWidth: 1,
    borderRadius: 10,
    padding: 10,
    marginBottom: 10,
  },
  savedBannerText: { color: '#166534', fontWeight: '700' },
  warnBanner: {
    backgroundColor: '#FEF9C3',
    borderColor: '#FDE68A',
    borderWidth: 1,
    borderRadius: 10,
    padding: 10,
  },
  warnBannerText: { color: '#92400E', fontSize: 13 },
});
