from enum import Enum


class ProjectStatus(str, Enum):
    IDEA = "idea"
    SCRIPT = "script"
    CUTS = "cuts"
    DESIGN = "design"
    OUTPUT = "output"
    COMPLETED = "completed"
    FAILED = "failed"


# A project status is the current production-work stage in this local workflow.
ProjectStage = ProjectStatus
