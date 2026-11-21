import type { BreadViewModel } from '@/domain/view-model';

export type BreadVM = BreadViewModel;
export type AssistMode = Parameters<BreadViewModel['assist']>[0];
