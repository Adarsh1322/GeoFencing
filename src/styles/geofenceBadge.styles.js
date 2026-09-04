import { StyleSheet } from 'react-native';
import { COLORS } from '../constants/colors';

export default StyleSheet.create({
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
    alignSelf: 'center',
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginRight: 8,
  },
  text: {
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  insideBadge: {
    backgroundColor: COLORS.successLight,
    borderWidth: 1,
    borderColor: COLORS.successBorder,
  },
  insideDot: {
    backgroundColor: COLORS.success,
  },
  insideText: {
    color: COLORS.success,
  },
  outsideBadge: {
    backgroundColor: COLORS.dangerLight,
    borderWidth: 1,
    borderColor: COLORS.dangerBorder,
  },
  outsideDot: {
    backgroundColor: COLORS.danger,
  },
  outsideText: {
    color: COLORS.danger,
  },
  locatingBadge: {
    backgroundColor: COLORS.warningLight,
    borderWidth: 1,
    borderColor: '#FDE68A',
  },
  locatingDot: {
    backgroundColor: COLORS.warning,
  },
  locatingText: {
    color: COLORS.warning,
  },
});
