import { useState, type ReactNode } from 'react';
import type { Profile } from '@/lib/types';
import { useProfile, useProfileHistory, useUpdateProfile } from '@/hooks/useApi';
import { formatDateTime } from '@/lib/utils';
import { PageHeader } from '@/components/PageHeader';
import { ConfidenceBadge } from '@/components/ConfidenceBadge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import {
  Collapsible,
  CollapsibleContent,
} from '@/components/ui/collapsible';

type FamilyMember = {
  name?: string;
  relation?: string;
  birthday?: string;
  [key: string]: unknown;
};

const FAMILY_RELATION_ALIASES: Record<string, string> = {
  children: 'child',
  kids: 'child',
  parents: 'parent',
  siblings: 'sibling',
  spouses: 'spouse',
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function humanizeLabel(value: string): string {
  return value
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function normalizeFamilyRelation(value: string): string {
  const normalized = value.trim().toLowerCase().replace(/\s+/g, '_');
  if (FAMILY_RELATION_ALIASES[normalized]) {
    return FAMILY_RELATION_ALIASES[normalized];
  }
  if (normalized.endsWith('s') && normalized.length > 1) {
    return normalized.slice(0, -1);
  }
  return normalized;
}

function isFamilyMemberShape(value: unknown): value is FamilyMember {
  if (!isRecord(value)) return false;
  return 'name' in value || 'birthday' in value || 'age' in value || 'date_of_birth' in value;
}

function formatPrimitive(value: unknown): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (value === null || value === undefined) return 'Not set';
  return JSON.stringify(value);
}

function renderStructuredValue(value: unknown, depth = 0): ReactNode {
  if (value === null || value === undefined) {
    return <span className="text-muted-foreground">Not set</span>;
  }

  if (Array.isArray(value)) {
    if (value.length === 0) {
      return <span className="text-muted-foreground">None</span>;
    }
    if (depth >= 2) {
      return <span className="text-foreground">{JSON.stringify(value)}</span>;
    }
    return (
      <ul className="list-disc list-inside space-y-1">
        {value.map((item, index) => (
          <li key={`${depth}-${index}`} className="text-foreground">
            {renderStructuredValue(item, depth + 1)}
          </li>
        ))}
      </ul>
    );
  }

  if (isRecord(value)) {
    const entries = Object.entries(value);
    if (entries.length === 0) {
      return <span className="text-muted-foreground">Empty object</span>;
    }
    if (depth >= 2) {
      return <span className="text-foreground">{JSON.stringify(value)}</span>;
    }
    return (
      <div className="space-y-1">
        {entries.map(([key, nestedValue]) => (
          <div key={`${depth}-${key}`} className="text-sm">
            <span className="font-medium text-foreground">{humanizeLabel(key)}:</span>
            <div className="mt-1 text-muted-foreground">{renderStructuredValue(nestedValue, depth + 1)}</div>
          </div>
        ))}
      </div>
    );
  }

  return <span className="text-foreground">{formatPrimitive(value)}</span>;
}

function getWorkRole(data: Partial<Profile['data']>): string | undefined {
  return data.career?.primary_job?.title || data.work?.role;
}

function getWorkCompany(data: Partial<Profile['data']>): string | undefined {
  return data.career?.primary_job?.company || data.work?.company;
}

export default function Profile() {
  const { data: profile, isLoading, error } = useProfile();
  const { data: history } = useProfileHistory();
  const updateProfile = useUpdateProfile();

  const [isEditing, setIsEditing] = useState(false);
  const [editData, setEditData] = useState<Partial<Profile['data']>>({});
  const [showHistory, setShowHistory] = useState(false);

  const handleEdit = () => {
    setEditData(profile?.data || {});
    setIsEditing(true);
  };

  const handleSave = async () => {
    await updateProfile.mutateAsync(editData);
    setIsEditing(false);
  };

  const handleCancel = () => {
    setEditData({});
    setIsEditing(false);
  };

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <div className="w-16 h-16 border-4 border-primary border-t-transparent rounded-full animate-spin mb-4" />
          <p className="text-muted-foreground">Loading profile...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center text-destructive">
          <p>Error loading profile: {error.message}</p>
        </div>
      </div>
    );
  }

  const profileData = isEditing ? editData : profile?.data || {};
  const confidence = 0.85; // Mock confidence score

  return (
    <div className="px-6 py-8 max-w-4xl mx-auto">
      {/* Header */}
      <PageHeader
        title="Your Profile"
        description={`Version ${profile?.version || 1} \u00b7 Last updated ${formatDateTime(profile?.updated_at || new Date())}`}
      >
        <Button
          variant="outline"
          onClick={() => setShowHistory(!showHistory)}
        >
          {showHistory ? 'Hide History' : 'Show History'}
        </Button>
        {!isEditing ? (
          <Button onClick={handleEdit}>
            Edit Profile
          </Button>
        ) : (
          <>
            <Button variant="outline" onClick={handleCancel}>
              Cancel
            </Button>
            <Button
              onClick={handleSave}
              disabled={updateProfile.isPending}
            >
              {updateProfile.isPending ? 'Saving...' : 'Save Changes'}
            </Button>
          </>
        )}
      </PageHeader>

      {/* Version History */}
      <Collapsible open={showHistory} onOpenChange={setShowHistory}>
        <CollapsibleContent>
          {history && (
            <Card className="mb-8">
              <CardHeader>
                <CardTitle>Version History</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  {history.map((version, idx: number) => (
                    <div key={idx} className="flex items-center justify-between bg-muted rounded-lg p-3">
                      <div>
                        <div className="font-medium text-foreground">Version {version.version}</div>
                        <div className="text-sm text-muted-foreground">{formatDateTime(version.updated_at)}</div>
                      </div>
                      <Button variant="link" size="sm">
                        View
                      </Button>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}
        </CollapsibleContent>
      </Collapsible>

      {/* Profile Fields */}
      <div className="space-y-6">
        {/* Basic Info */}
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between w-full">
              <CardTitle>Basic Information</CardTitle>
              <ConfidenceBadge confidence={confidence} />
            </div>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              <div className="space-y-1.5">
                <Label>Name</Label>
                {isEditing ? (
                  <Input
                    value={editData?.name || ''}
                    onChange={(e) => setEditData({ ...editData, name: e.target.value })}
                  />
                ) : (
                  <p className="text-foreground text-sm">
                    {profileData.name || <span className="text-muted-foreground">Not set</span>}
                  </p>
                )}
              </div>

              <Separator />

              <div className="space-y-1.5">
                <Label>Timezone</Label>
                {isEditing ? (
                  <select
                    value={editData?.timezone || ''}
                    onChange={(e) => setEditData({ ...editData, timezone: e.target.value })}
                    className="h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px] dark:bg-input/30 dark:border-input"
                  >
                    <option value="America/New_York">Eastern Time</option>
                    <option value="America/Chicago">Central Time</option>
                    <option value="America/Denver">Mountain Time</option>
                    <option value="America/Los_Angeles">Pacific Time</option>
                    <option value="Europe/London">London</option>
                    <option value="Europe/Paris">Paris</option>
                    <option value="Asia/Tokyo">Tokyo</option>
                    <option value="Australia/Sydney">Sydney</option>
                  </select>
                ) : (
                  <p className="text-foreground text-sm">
                    {profileData.timezone || <span className="text-muted-foreground">Not set</span>}
                  </p>
                )}
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Family */}
        <Card>
          <CardHeader>
            <CardTitle>Family</CardTitle>
          </CardHeader>
          <CardContent>
            {(() => {
              const family = profileData.family;
              const familyMembers: FamilyMember[] = [];
              const familyContext: Array<{ key: string; value: unknown }> = [];

              if (Array.isArray(family)) {
                for (const [index, member] of family.entries()) {
                  if (isFamilyMemberShape(member)) {
                    familyMembers.push(member);
                  } else {
                    familyContext.push({ key: `members_${index}`, value: member });
                  }
                }
              } else if (family && typeof family === 'object') {
                for (const [key, value] of Object.entries(family as Record<string, unknown>)) {
                  if (Array.isArray(value)) {
                    const relation = normalizeFamilyRelation(key);
                    const memberValues = value.filter(isFamilyMemberShape);
                    if (memberValues.length > 0) {
                      familyMembers.push(
                        ...memberValues.map((member) => ({
                          ...member,
                          relation:
                            typeof member.relation === 'string'
                              ? normalizeFamilyRelation(member.relation)
                              : relation,
                        })),
                      );
                    }
                    if (memberValues.length !== value.length) {
                      familyContext.push({
                        key,
                        value: value.filter((entry) => !isFamilyMemberShape(entry)),
                      });
                    }
                    continue;
                  }

                  if (isFamilyMemberShape(value)) {
                    familyMembers.push({
                      ...(value as FamilyMember),
                      relation:
                        typeof (value as FamilyMember).relation === 'string'
                          ? normalizeFamilyRelation((value as FamilyMember).relation as string)
                          : normalizeFamilyRelation(key),
                    });
                  } else {
                    familyContext.push({ key, value });
                  }
                }
              }

              return familyMembers.length > 0 || familyContext.length > 0 ? (
                <>
                  {familyMembers.length > 0 && (
                    <div className="space-y-3">
                      {familyMembers.map((member, idx: number) => (
                        <div key={idx} className="flex items-center justify-between bg-muted rounded-lg p-3">
                          <div>
                            <div className="font-medium text-foreground">{member.name || 'Unnamed family member'}</div>
                            <div className="text-sm text-muted-foreground">
                              {humanizeLabel(member.relation || 'family_member')}
                            </div>
                          </div>
                          {member.birthday && (
                            <div className="text-sm text-muted-foreground">{member.birthday}</div>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                  {familyContext.length > 0 && (
                    <div className="mt-3 space-y-1.5">
                      {familyContext.map(({ key, value }) => (
                        <div key={key} className="text-sm text-muted-foreground">
                          <span className="font-medium text-foreground">
                            {humanizeLabel(key)}:
                          </span>{' '}
                          {renderStructuredValue(value)}
                        </div>
                      ))}
                    </div>
                  )}
                </>
              ) : (
                <p className="text-muted-foreground text-sm">No family members added</p>
              );
            })()}
          </CardContent>
        </Card>

        {/* Work */}
        <Card>
          <CardHeader>
            <CardTitle>Work</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              <div className="space-y-1.5">
                <Label>Role</Label>
                {isEditing ? (
                  <Input
                    value={getWorkRole(editData) || ''}
                    onChange={(e) =>
                      setEditData({
                        ...editData,
                        career: {
                          ...(editData?.career || {}),
                          primary_job: {
                            ...(editData?.career?.primary_job || {}),
                            title: e.target.value,
                          },
                        },
                        work: { ...editData?.work, role: e.target.value },
                      })
                    }
                  />
                ) : (
                  <p className="text-foreground text-sm">
                    {getWorkRole(profileData) || <span className="text-muted-foreground">Not set</span>}
                  </p>
                )}
              </div>

              <Separator />

              <div className="space-y-1.5">
                <Label>Company</Label>
                {isEditing ? (
                  <Input
                    value={getWorkCompany(editData) || ''}
                    onChange={(e) =>
                      setEditData({
                        ...editData,
                        career: {
                          ...(editData?.career || {}),
                          primary_job: {
                            ...(editData?.career?.primary_job || {}),
                            company: e.target.value,
                          },
                        },
                        work: { ...editData?.work, company: e.target.value },
                      })
                    }
                  />
                ) : (
                  <p className="text-foreground text-sm">
                    {getWorkCompany(profileData) || <span className="text-muted-foreground">Not set</span>}
                  </p>
                )}
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Food Preferences */}
        <Card>
          <CardHeader>
            <CardTitle>Food Preferences</CardTitle>
          </CardHeader>
          <CardContent>
            {profileData.preferences?.food?.favorites && profileData.preferences.food.favorites.length > 0 ? (
              <div className="space-y-4">
                <div>
                  <Label className="mb-2">Favorites</Label>
                  <div className="flex flex-wrap gap-2 mt-2">
                    {profileData.preferences.food.favorites.map((item: string, idx: number) => (
                      <span
                        key={idx}
                        className="px-3 py-1 rounded-full text-sm bg-orange-500/20 text-orange-400 border border-orange-500/30"
                      >
                        {item}
                      </span>
                    ))}
                  </div>
                </div>
                {profileData.preferences.food.regional_style && (
                  <>
                    <Separator />
                    <div className="space-y-1.5">
                      <Label>Regional Style</Label>
                      <p className="text-foreground text-sm">{profileData.preferences.food.regional_style}</p>
                    </div>
                  </>
                )}
              </div>
            ) : (
              <p className="text-muted-foreground text-sm">No food preferences set</p>
            )}
          </CardContent>
        </Card>

        {/* Health */}
        <Card>
          <CardHeader>
            <CardTitle>Health</CardTitle>
          </CardHeader>
          <CardContent>
            {(profileData.health?.conditions?.length || profileData.dietary_restrictions?.length || profileData.health?.dietary_goals?.length) ? (
              <div className="space-y-4">
                {profileData.health?.conditions && profileData.health.conditions.length > 0 && (
                  <div>
                    <Label className="mb-2">Conditions</Label>
                    <div className="flex flex-wrap gap-2 mt-2">
                      {profileData.health.conditions.map((item: string, idx: number) => (
                        <span
                          key={idx}
                          className="px-3 py-1 rounded-full text-sm bg-red-500/20 text-red-400"
                        >
                          {item}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
                {Array.isArray(profileData.dietary_restrictions) && profileData.dietary_restrictions.length > 0 && (
                  <>
                    {profileData.health?.conditions && profileData.health.conditions.length > 0 && <Separator />}
                    <div>
                      <Label className="mb-2">Dietary Restrictions</Label>
                      <div className="flex flex-wrap gap-2 mt-2">
                        {profileData.dietary_restrictions.map((item: string, idx: number) => (
                          <span
                            key={idx}
                            className="px-3 py-1 rounded-full text-sm bg-blue-500/20 text-blue-400"
                          >
                            {item}
                          </span>
                        ))}
                      </div>
                    </div>
                  </>
                )}
                {profileData.health?.dietary_goals && profileData.health.dietary_goals.length > 0 && (
                  <>
                    {((profileData.health?.conditions && profileData.health.conditions.length > 0) ||
                      (Array.isArray(profileData.dietary_restrictions) && profileData.dietary_restrictions.length > 0)) && <Separator />}
                    <div>
                      <Label className="mb-2">Dietary Goals</Label>
                      <div className="flex flex-wrap gap-2 mt-2">
                        {profileData.health.dietary_goals.map((item: string, idx: number) => (
                          <span
                            key={idx}
                            className="px-3 py-1 rounded-full text-sm bg-green-500/20 text-green-400"
                          >
                            {item}
                          </span>
                        ))}
                      </div>
                    </div>
                  </>
                )}
              </div>
            ) : (
              <p className="text-muted-foreground text-sm">No health information set</p>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
