import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  SafeAreaView,
  StyleSheet,
  StatusBar,
  Image,
  ActivityIndicator,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { runLocalAgentPipeline, LocalAgentOutput } from '@/lib/agents';
import { getGeminiExplanation } from '@/lib/gemini';

const LAVENDER_BG = '#F3EFFE';
const LAVENDER    = '#C4B5FD';
const PURPLE      = '#7C3AED';
const PURPLE_LIGHT= '#EDE9FE';
const GRAY_LABEL  = '#9CA3AF';
const GRAY_TEXT   = '#374151';
const WHITE       = '#FFFFFF';

const URGENCY_CONFIG = {
  urgent: { bg: '#FEE2E2', text: '#B91C1C', badge: '#EF4444', label: 'Urgent — Seek care today' },
  soon:   { bg: '#FEF3C7', text: '#B45309', badge: '#F59E0B', label: 'See a doctor within 1–3 days' },
  monitor:{ bg: '#DCFCE7', text: '#166534', badge: '#4ADE80', label: 'Monitor for now' },
};

// Parse Gemini bullet points into a clean array
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
  const { photoUri, symptoms } = useLocalSearchParams<{
    photoUri: string;
    symptoms: string;
  }>();

  const [output, setOutput] = useState<LocalAgentOutput | null>(null);
  const [geminiText, setGeminiText] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const run = async () => {
      setLoading(true);
      const result = runLocalAgentPipeline(symptoms ?? '');
      setOutput(result);

      const explanation = await getGeminiExplanation({
        symptoms: symptoms ?? '',
        condition: result.consensus.condition,
        confidence: result.consensus.confidence,
        urgency: result.consensus.urgency,
        whenToSeeDoctor: result.consensus.whenToSeeDoctor,
      });
      setGeminiText(explanation);
      setLoading(false);
    };
    run();
  }, []);

  const urgency = (output?.consensus.urgency ?? 'monitor') as keyof typeof URGENCY_CONFIG;
  const urgencyCfg = URGENCY_CONFIG[urgency];
  const confidence = output ? Math.round(output.consensus.confidence * 100) : 0;
  const nextSteps = output ? getNextSteps(urgency, output.consensus.condition) : [];
  const bullets = geminiText ? parseBullets(geminiText) : [];

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
          <Text style={styles.loadingText}>Analyzing your skin...</Text>
          <Text style={styles.loadingSubtext}>Running multi-agent analysis privately on device</Text>
        </View>
      ) : (
        <ScrollView contentContainerStyle={styles.scrollContent}>

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
                <Text style={styles.conditionName}>{output?.consensus.condition ?? '—'}</Text>
              </View>
            </View>

            {/* Confidence bar */}
            <View>
              <View style={styles.confidenceRow}>
                <Text style={styles.sectionLabel}>CONFIDENCE</Text>
                <Text style={styles.confidencePct}>{confidence}%</Text>
              </View>
              <View style={styles.barTrack}>
                <View style={[styles.barFill, { width: `${confidence}%` as any }]} />
              </View>
            </View>
          </View>

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
          </View>

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
    backgroundColor: PURPLE,
    borderRadius: 99,
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
});
