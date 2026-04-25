import { useState, useRef } from 'react';
import {
  View,
  Text,
  Image,
  TouchableOpacity,
  TextInput,
  ScrollView,
  SafeAreaView,
  StyleSheet,
  StatusBar,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';

// Symptom chips — each label maps directly to RISK_TOKENS in agents.ts
const SYMPTOM_CHIPS = [
  'Pain',
  'Itchy',
  'Burning',
  'Oozing',
  'Redness',
  'Spreading',
  'Swelling',
  'Fever',
  'Bleeding',
  'Painless',
  'Other',
];

const DURATION_CHIPS = [
  { label: '1–2 days', value: 'had it for 1 day' },
  { label: '1 week',   value: 'had it for 7 days' },
  { label: '1 month',  value: 'had it for 30 days' },
  { label: '3+ months', value: 'had it for 90 days' },
];

const LAVENDER_BG   = '#F3EFFE';
const LAVENDER      = '#C4B5FD';
const PURPLE        = '#7C3AED';
const GRAY_LABEL    = '#9CA3AF';
const GRAY_TEXT     = '#374151';
const WHITE         = '#FFFFFF';

export default function SymptomsScreen() {
  const router = useRouter();
  const { photoUri } = useLocalSearchParams<{ photoUri: string }>();

  const [selectedDuration, setSelectedDuration] = useState<string | null>(null);
  const [selectedSymptoms, setSelectedSymptoms] = useState<string[]>([]);
  const [otherExpanded, setOtherExpanded] = useState(false);
  const [otherText, setOtherText] = useState('');
  const [freeText, setFreeText] = useState('');
  const [isListening, setIsListening] = useState(false);

  const toggleSymptom = (chip: string) => {
    if (chip === 'Other') {
      setOtherExpanded((prev) => !prev);
      if (selectedSymptoms.includes('Other')) {
        setSelectedSymptoms((prev) => prev.filter((s) => s !== 'Other'));
      } else {
        setSelectedSymptoms((prev) => [...prev, 'Other']);
      }
      return;
    }
    setSelectedSymptoms((prev) =>
      prev.includes(chip) ? prev.filter((s) => s !== chip) : [...prev, chip]
    );
  };

  // Builds a single symptom string to feed into runSymptomAgent()
  const buildSymptomString = () => {
    const parts: string[] = [];
    if (selectedDuration) parts.push(selectedDuration);
    const chips = selectedSymptoms
      .filter((s) => s !== 'Other')
      .map((s) => s.toLowerCase());
    if (chips.length) parts.push(chips.join(', '));
    if (otherText.trim()) parts.push(otherText.trim());
    if (freeText.trim()) parts.push(freeText.trim());
    return parts.join('. ');
  };

  const handleAnalyze = () => {
    const symptomString = buildSymptomString();
    router.push({
      pathname: '/(tabs)',
      params: { photoUri, symptoms: symptomString, autoAnalyze: '1' },
    });
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar barStyle="dark-content" backgroundColor={LAVENDER_BG} />
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        {/* Header */}
        <View style={styles.header}>
          <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
            <Text style={styles.backArrow}>←</Text>
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Tell Us More</Text>
          <Text style={styles.stepIndicator}>2 of 3</Text>
        </View>

        <ScrollView
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
        >
          {/* Photo thumbnail + reassurance */}
          <View style={styles.card}>
            <View style={styles.thumbnailRow}>
              {photoUri ? (
                <Image source={{ uri: photoUri }} style={styles.thumbnail} />
              ) : (
                <View style={[styles.thumbnail, styles.thumbnailPlaceholder]}>
                  <Text style={{ fontSize: 28 }}>📷</Text>
                </View>
              )}
              <View style={styles.thumbnailText}>
                <Text style={styles.thumbnailHeading}>Almost there!</Text>
                <Text style={styles.thumbnailSubtext}>
                  Give us a bit more detail so we can help you accurately.
                </Text>
              </View>
            </View>
          </View>

          {/* Duration */}
          <View style={styles.card}>
            <Text style={styles.sectionLabel}>HOW LONG HAVE YOU HAD IT?</Text>
            <View style={styles.chipGrid}>
              {DURATION_CHIPS.map((d) => {
                const selected = selectedDuration === d.value;
                return (
                  <TouchableOpacity
                    key={d.value}
                    style={[styles.chip, selected && styles.chipSelected]}
                    onPress={() => setSelectedDuration(selected ? null : d.value)}
                    activeOpacity={0.8}
                  >
                    <Text style={[styles.chipText, selected && styles.chipTextSelected]}>
                      {d.label}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          </View>

          {/* Symptom chips */}
          <View style={styles.card}>
            <Text style={styles.sectionLabel}>WHAT ARE YOU FEELING?</Text>
            <View style={styles.chipWrap}>
              {SYMPTOM_CHIPS.map((chip) => {
                const selected = selectedSymptoms.includes(chip);
                return (
                  <TouchableOpacity
                    key={chip}
                    style={[styles.chip, selected && styles.chipSelected]}
                    onPress={() => toggleSymptom(chip)}
                    activeOpacity={0.8}
                  >
                    <Text style={[styles.chipText, selected && styles.chipTextSelected]}>
                      {chip}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>

            {/* Other expanded input */}
            {otherExpanded && (
              <TextInput
                style={styles.otherInput}
                placeholder="Describe your symptom..."
                placeholderTextColor={GRAY_LABEL}
                value={otherText}
                onChangeText={setOtherText}
                multiline
              />
            )}
          </View>

          {/* Free text + voice */}
          <View style={styles.card}>
            <Text style={styles.sectionLabel}>ANYTHING ELSE? (OPTIONAL)</Text>
            <TextInput
              style={styles.freeTextInput}
              placeholder={'e.g. "Started after using a new lotion, only on my arm..."'}
              placeholderTextColor={GRAY_LABEL}
              value={freeText}
              onChangeText={setFreeText}
              multiline
              textAlignVertical="top"
            />

            {/* Voice button — bottom of this card */}
            <TouchableOpacity
              style={[styles.voiceBtn, isListening && styles.voiceBtnActive]}
              onPress={() => setIsListening((prev) => !prev)}
              activeOpacity={0.85}
            >
              <Text style={[styles.voiceBtnText, isListening && styles.voiceBtnTextActive]}>
                {isListening ? '⏹  Stop Recording' : '🎙  Speak instead'}
              </Text>
            </TouchableOpacity>
          </View>

          {/* Analyze CTA */}
          <TouchableOpacity
            style={styles.analyzeBtn}
            onPress={handleAnalyze}
            activeOpacity={0.85}
          >
            <Text style={styles.analyzeBtnText}>Analyze My Skin  →</Text>
          </TouchableOpacity>

          <Text style={styles.disclaimer}>
            Not a medical diagnosis. Always consult a doctor for serious concerns.
          </Text>
        </ScrollView>
      </KeyboardAvoidingView>
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
  backBtn: {
    width: 36,
  },
  backArrow: {
    fontSize: 22,
    color: PURPLE,
    fontWeight: '600',
  },
  headerTitle: {
    fontSize: 17,
    fontWeight: '700',
    color: GRAY_TEXT,
  },
  stepIndicator: {
    fontSize: 13,
    color: GRAY_LABEL,
    fontWeight: '600',
  },
  scrollContent: {
    padding: 16,
    gap: 14,
    paddingBottom: 40,
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

  // Thumbnail
  thumbnailRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
  },
  thumbnail: {
    width: 80,
    height: 80,
    borderRadius: 14,
    backgroundColor: LAVENDER_BG,
  },
  thumbnailPlaceholder: {
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1.5,
    borderColor: LAVENDER,
  },
  thumbnailText: {
    flex: 1,
    gap: 4,
  },
  thumbnailHeading: {
    fontSize: 16,
    fontWeight: '700',
    color: GRAY_TEXT,
  },
  thumbnailSubtext: {
    fontSize: 13,
    color: GRAY_LABEL,
    lineHeight: 19,
  },

  // Chips
  chipGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  chipWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  chip: {
    paddingVertical: 9,
    paddingHorizontal: 16,
    borderRadius: 50,
    borderWidth: 1.5,
    borderColor: LAVENDER,
    backgroundColor: WHITE,
  },
  chipSelected: {
    backgroundColor: PURPLE,
    borderColor: PURPLE,
  },
  chipText: {
    fontSize: 14,
    color: GRAY_TEXT,
    fontWeight: '500',
  },
  chipTextSelected: {
    color: WHITE,
    fontWeight: '600',
  },

  // Other input
  otherInput: {
    borderWidth: 1.5,
    borderColor: LAVENDER,
    borderRadius: 12,
    padding: 12,
    minHeight: 70,
    fontSize: 14,
    color: GRAY_TEXT,
    backgroundColor: LAVENDER_BG,
    textAlignVertical: 'top',
  },

  // Free text
  freeTextInput: {
    borderWidth: 1.5,
    borderColor: LAVENDER,
    borderRadius: 12,
    padding: 14,
    minHeight: 90,
    fontSize: 14,
    color: GRAY_TEXT,
    backgroundColor: '#FAFAFA',
    textAlignVertical: 'top',
  },

  // Voice button
  voiceBtn: {
    borderWidth: 1.5,
    borderColor: PURPLE,
    borderRadius: 12,
    paddingVertical: 13,
    alignItems: 'center',
    backgroundColor: WHITE,
  },
  voiceBtnActive: {
    backgroundColor: PURPLE,
  },
  voiceBtnText: {
    fontSize: 15,
    fontWeight: '600',
    color: PURPLE,
  },
  voiceBtnTextActive: {
    color: WHITE,
  },

  // Analyze button
  analyzeBtn: {
    backgroundColor: PURPLE,
    borderRadius: 16,
    paddingVertical: 18,
    alignItems: 'center',
    shadowColor: PURPLE,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.35,
    shadowRadius: 10,
    elevation: 5,
    marginTop: 4,
  },
  analyzeBtnText: {
    color: WHITE,
    fontSize: 17,
    fontWeight: '700',
    letterSpacing: 0.3,
  },
  disclaimer: {
    textAlign: 'center',
    fontSize: 12,
    color: GRAY_LABEL,
    marginTop: 4,
    paddingBottom: 8,
  },
});
